export type TextMeasurer = {
  setFont(font: string): void;
  measureText(text: string): { width: number };
};

export type CanvasLike = {
  font: string;
  measureText(text: string): { width: number };
};

export function createTextMeasurerFromCanvas(context: CanvasLike): TextMeasurer {
  return {
    setFont(font: string) {
      context.font = font;
    },
    measureText(text: string) {
      return { width: context.measureText(text).width };
    }
  };
}
