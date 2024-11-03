import SQSConsumer from '..';
import cluster from 'node:cluster';
import { SQSClient } from '@aws-sdk/client-sqs';

if (cluster.isPrimary) {
  // Creating 2 worker processes
  cluster.fork();
  cluster.fork();
} else {
  // Use the below template if you want to implement inter-process-communication within your project.
  process.on('message', (message) => {
    if ((message?.hasOwnProperty('RawSQSMessage') || message?.hasOwnProperty('ProcessedSQSMessage'))) {
      // Ignore these messages as they are used within the implementation of SQSConsumer
      return;
    }
    //Implement your logic below.
  });
}

const sqsConsumer = new SQSConsumer({
  sqsClient: new SQSClient(),
  sqsPollOptions: {
    QueueUrl: 'add_your_queue_url',
  },
  messagePreprocessor: async () => {
    // Implement any pre-processing logic here that is going to be executed on the messages within the master process, before passing to workers.
    // This function is optional
  }
});

if (cluster.isWorker) {
  sqsConsumer.on('sqsMessage', (message) => {
    console.log('Received the follwing message from SQS: ', message);
  });
}

sqsConsumer.startPolling();
