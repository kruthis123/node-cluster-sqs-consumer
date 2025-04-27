# SQSConsumer for node services running in cluster mode

This package provides a simple wrapper around AWS SDK's SQS client, allowing to easily consume messages from an Amazon SQS (Simple Queue Service) queue. This package is designed specifically for node.js projects that are utilizing cluster mode and want to consume SQS messages within all the worker processes. It makes use of inter-process-communication, where the master process continuously polls for messages from SQS and passes the messages on to all worker processess whenever available. Since SQS is primarily designed to work with a single consumer, without inter-process-communication, each worker process would have to poll a separate queue with same messages replicated across all the queues.

## Installation

To install this package using npm, run the following command

```bash
npm install node-cluster-sqs-consumer
```

## Usage

### Creating an Instance

To create an instance of SQSConsumer, you need to pass in an SQSClient instance and options for polling.

```js
import { SQSClient } from '@aws-sdk/client-sqs';
import SQSConsumer from 'node-cluster-sqs-consumer';

const sqsClient = new SQSClient({ region: 'your-region' });
const sqsConsumer = new SQSConsumer({
  sqsClient: sqsClient,
  sqsPollOptions: {
    QueueUrl: 'https://example.com/queue',
    MaxNumberOfMessages: 5,
    WaitTimeSeconds: 10,
  },
});
```

### Handling Messages

Messages that are received from SQS queue are passed on to all workers through an event emitter. In order to consume these messages within workers, you must create an event listener within each of your worker processes as below.

```js
sqsConsumer.on('sqsMessage', (message) => {
  console.log('Received message:', message);
});
```

You can optionally, pre-process messages within the master process before passing them on to the worker processes. To do so, implement your pre-processing logic within a function and pass that within the 'messagePreprocessor' parameter of the SQSConsumer like below.

```js
const sqsConsumer = new SQSConsumer({
  sqsClient: sqsClient,
  sqsPollOptions: {
    QueueUrl: 'https://example.com/queue',
    MaxNumberOfMessages: 5,
    WaitTimeSeconds: 10,
  },
  messagePreprocessor: async (message) => {
    return message.Body; // Example of pre-processing
  },
});
```

### Starting the Consumer

You can start polling for messages using the startPolling method. This will continuously poll the SQS queue for new messages.

```js
sqsConsumer.startPolling();
```

### Pausing and Resuming

To pause the polling, use the pausePolling method. To resume, call resumePolling.

```js
sqsConsumer.pausePolling();
// Later, to resume
sqsConsumer.resumePolling();
```

### Error Handling

Errors during message processing or SQS operations are handled by emitting events. Ensure to add listeners for the sqsError and preProcessorError events to handle any issues that arise.

preProcessorError: Emitted if there is an error during message preprocessing.
sqsError: Emitted when there is an error with SQS operations, such as receiving or deleting messages.

You can listen to these events like so:

```js
sqsConsumer.on('preProcessorError', ({ error, Message }) => {
  console.error('Preprocessing error:', error, Message);
});

sqsConsumer.on('sqsError', ({ error, operation }) => {
  console.error(`SQS error during ${operation}:`, error);
});
```

## Example

Here's a full example of using SQSConsumer:

```js
import { SQSClient } from '@aws-sdk/client-sqs';
import SQSConsumer from 'node-cluster-sqs-consumer';

const sqsClient = new SQSClient();
const sqsConsumer = new SQSConsumer({
  sqsClient: sqsClient,
  sqsPollOptions: {
    QueueUrl: 'https://example.com/queue',
    MaxNumberOfMessages: 5,
    WaitTimeSeconds: 10,
  },
  messagePreprocessor: async (message) => {
    console.log('Processing message:', message);
    return message.Body; // Example of processing
  },
});

sqsConsumer.on('sqsMessage', (message) => {
  console.log('Message relayed to worker:', message);
});

sqsConsumer.startPolling();
```
