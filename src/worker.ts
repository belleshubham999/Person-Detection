import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-cpu';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

let model: cocoSsd.ObjectDetection | null = null;

async function init() {
  // Explicitly set the backend to CPU as requested (no GPU/WebGL)
  await tf.setBackend('cpu');
  await tf.ready();
  console.log('Worker: TFJS Backend set to CPU');
  
  model = await cocoSsd.load({
    base: 'lite_mobilenet_v2' // Use the lightest model for CPU performance
  });
  console.log('Worker: COCO-SSD Model Loaded');
  
  self.postMessage({ type: 'READY' });
}

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'INIT') {
    await init();
  } else if (e.data.type === 'PROCESS') {
    if (!model) return;

    const { imageBitmap, width, height } = e.data;
    
    // Create a tensor from the ImageBitmap
    // Note: tf.browser.fromPixels works with ImageBitmap
    const pixels = tf.browser.fromPixels(imageBitmap);
    
    const predictions = await model.detect(pixels);
    
    // Cleanup tensor to avoid memory leaks
    pixels.dispose();
    
    self.postMessage({ 
      type: 'RESULTS', 
      predictions,
      timestamp: e.data.timestamp
    });
  }
};
