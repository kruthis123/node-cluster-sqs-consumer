import EventEmitter from 'node:events';
import {
  SQSClient,
  Message,
  ReceiveMessageCommandInput,
  ReceiveMessageCommand,
  ReceiveMessageCommandOutput,
  DeleteMessageBatchCommand,
  DeleteMessageBatchCommandInput
} from '@aws-sdk/client-sqs';
import cluster from 'node:cluster';
import { POLLING_STATUS } from './constants';

interface SQSConsumerOptions {
  sqsClient: SQSClient,
  sqsPollOptions: ReceiveMessageCommandInput,
  messagePreprocessor?: (message: Message) => Promise<any>,
}

class SQSConsumer extends EventEmitter {
  private sqsClient: SQSClient;
  private sqsPollOptions: Omit<ReceiveMessageCommandInput, 'ReceiveRequestAttemptId'>;
  private pollingStatus: 'ACTIVE' | 'INACTIVE' = 'INACTIVE';
  private messagePreprocessor?: (message: Message) => Promise<any>;

  constructor(options: SQSConsumerOptions) {
    super();
    this.sqsClient = options.sqsClient;
    this.sqsPollOptions = options.sqsPollOptions;
    this.messagePreprocessor = options.messagePreprocessor;
    this._createWorkerSQSMessageListeners();
  }

  private _createWorkerSQSMessageListeners() {
    if (cluster.isWorker) {
      cluster.worker?.on('message', (message) => {
        if (typeof message === 'object' && (message.RawSQSMessage || message.ProcessedSQSMessage)) {
          this.emit('sqsMessage', message);
        }
      })
    }
  }

  private _relayMessageToWorkers(message: any) {
    if (cluster.workers) {
      Object.values(cluster.workers).forEach(worker => {
        worker?.send(message);
      });
    }
  }

  private _getReceiveMessageInput(): ReceiveMessageCommandInput {
    const input: ReceiveMessageCommandInput = {
      QueueUrl: this.sqsPollOptions.QueueUrl,
      MessageAttributeNames: this.sqsPollOptions.MessageAttributeNames,
      MessageSystemAttributeNames: this.sqsPollOptions.MessageSystemAttributeNames,
      MaxNumberOfMessages: this.sqsPollOptions.MaxNumberOfMessages ?? 10,
      VisibilityTimeout: this.sqsPollOptions.VisibilityTimeout,
      WaitTimeSeconds: this.sqsPollOptions.WaitTimeSeconds ?? 20,
    }
    return input;
  }

  private async _processSQSMessage(message: Message): Promise<void> {
    if (this.messagePreprocessor) {
      let processedMessage;
      try {
        processedMessage = await this.messagePreprocessor(message);
      } catch (error) {
        this.emit('preProcessorError', { error, Message: message });
      }
      this._relayMessageToWorkers({ ProcessedSQSMessage: processedMessage });
    } else {
      this._relayMessageToWorkers({ RawSQSMessage: message });
    }
  }

  private async _deleteSQSMessages(deleteMessageEntries: { Id: string, ReceiptHandle: string }[]): Promise<void> {
    try {
      const input: DeleteMessageBatchCommandInput = {
        QueueUrl: this.sqsPollOptions.QueueUrl,
        Entries: deleteMessageEntries,
      };
      const command = new DeleteMessageBatchCommand(input);
      await this.sqsClient.send(command);
    } catch (error) {
      this.emit('sqsError', { error, operation: 'DeleteMessageBatch' });
    }
  }

  private async _pollForMessages(): Promise<ReceiveMessageCommandOutput | void> {
    try {
      const input = this._getReceiveMessageInput();
      const command = new ReceiveMessageCommand(input);
      const response = await this.sqsClient.send(command);
      return response;
    } catch (error) {
      this.emit('sqsError', { error, operation: 'ReceiveMessage' });
    }
  }

  async startPolling() {
    this.pollingStatus = POLLING_STATUS.ACTIVE;
    if (cluster.isPrimary) {
      while (this.pollingStatus === POLLING_STATUS.ACTIVE) {
        const pollResponse = await this._pollForMessages();
        if (pollResponse?.Messages?.length) {
          const deleteMessageEntries = [];
          for (const Message of pollResponse.Messages) {
            this._processSQSMessage(Message);
            deleteMessageEntries.push({ Id: Message.MessageId, ReceiptHandle: Message.ReceiptHandle });
          }
          this._deleteSQSMessages(deleteMessageEntries as { Id: string, ReceiptHandle: string }[]);
        }
      }
    }
  }

  pausePolling() {
    this.pollingStatus = POLLING_STATUS.INACTIVE;
  }

  resumePolling() {
    this.startPolling();
  }
}

export default SQSConsumer;
