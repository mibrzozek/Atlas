import { MeasureText } from 'common/workspace';

/** The weight texts on a workspace are drawn in (see `.workspace-text` in workspace.scss) */
export const TEXT_FONT_WEIGHT = 600;

let context: CanvasRenderingContext2D | undefined;
let fontFamily = 'sans-serif';

/** How wide a line of a text on a workspace is, measured in the font it is drawn in */
export const measureText: MeasureText = (line, fontSize) => {
  if (context === undefined) {
    context = document.createElement('canvas').getContext('2d')!;
    fontFamily = getComputedStyle(document.body).fontFamily || fontFamily;
  }
  context.font = `${TEXT_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
  return context.measureText(line).width;
};
