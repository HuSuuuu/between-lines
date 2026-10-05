import { generate } from './generator';
import { validateChart } from './validate';
import type { GenerationRequest } from './types';
self.onmessage = (event: MessageEvent<{ id: number; request: GenerationRequest }>) => {
  try {
    const chart = generate(event.data.request);
    validateChart(chart);
    self.postMessage({ id: event.data.id, chart });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : '地图生成失败',
    });
  }
};
