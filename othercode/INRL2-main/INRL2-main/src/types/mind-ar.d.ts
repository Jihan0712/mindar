// MindAR ships plain JavaScript. These are the parts of its image-tracking
// core (no renderer) that InRL uses.
declare module 'mind-ar/dist/mindar-image.prod.js' {
  export interface ControllerUpdate {
    type: 'updateMatrix' | 'processDone'
    targetIndex: number
    worldMatrix: number[] | null
  }

  export class Controller {
    constructor(options: {
      inputWidth: number
      inputHeight: number
      onUpdate?: (data: ControllerUpdate) => void
      maxTrack?: number
      filterMinCF?: number | null
      filterBeta?: number | null
      warmupTolerance?: number | null
      missTolerance?: number | null
    })
    inputWidth: number
    inputHeight: number
    addImageTargets(url: string): Promise<{ dimensions: [number, number][] }>
    dummyRun(input: HTMLVideoElement): Promise<void>
    processVideo(input: HTMLVideoElement): void
    stopProcessVideo(): void
    getProjectionMatrix(): number[]
    dispose(): void
  }

  export class Compiler {
    compileImageTargets(images: HTMLImageElement[], progress: (percent: number) => void): Promise<unknown>
    exportData(): ArrayBuffer
  }
}
