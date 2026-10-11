import { expose, transfer } from 'comlink';
import fse from 'fs-extra';

import TifLoader from '../image/TifLoader';

const tifLoader = new TifLoader();

const BMP_HEADER_SIZE = 54;

/**
 * Wraps the pixels in a BMP file: this needs no compression at all, so it is ready right away and
 * the browser can show it right away. Encoding as PNG takes seconds for a large image.
 * @returns undefined if the image has transparency, which this BMP flavour cannot store
 */
function toBmp({ data, width, height }: ImageData): ArrayBuffer | undefined {
  // Every row is padded to a multiple of 4 bytes
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const buffer = new ArrayBuffer(BMP_HEADER_SIZE + rowSize * height);
  const view = new DataView(buffer);
  view.setUint8(0, 0x42); // B
  view.setUint8(1, 0x4d); // M
  view.setUint32(2, buffer.byteLength, true);
  view.setUint32(10, BMP_HEADER_SIZE, true); // where the pixels start
  view.setUint32(14, 40, true); // size of the info header
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true); // negative: rows are stored from top to bottom
  view.setUint16(26, 1, true); // colour planes
  view.setUint16(28, 24, true); // bits per pixel
  view.setUint32(34, rowSize * height, true);
  view.setInt32(38, 2835, true); // 72 DPI
  view.setInt32(42, 2835, true);

  const out = new Uint8Array(buffer);
  let src = 0;
  for (let y = 0; y < height; y++) {
    let dst = BMP_HEADER_SIZE + y * rowSize;
    for (let x = 0; x < width; x++) {
      if (data[src + 3] !== 255) {
        return undefined;
      }
      // Stored as blue, green, red
      out[dst] = data[src + 2];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src];
      src += 4;
      dst += 3;
    }
  }
  return buffer;
}

async function toPng(imageData: ImageData): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

export class TifConverterWorker {
  /** Reads a TIFF file and converts it to an image the browser can show, without blocking the interface */
  async convert(filePath: string): Promise<{ data: ArrayBuffer; type: string }> {
    const file = await fse.readFile(filePath);
    // The decoder needs a buffer that only contains the file: a Node buffer can be a view on a larger one
    const imageData = await tifLoader.decode(
      file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    );
    const bmp = toBmp(imageData);
    const result =
      bmp !== undefined
        ? { data: bmp, type: 'image/bmp' }
        : { data: await toPng(imageData), type: 'image/png' };
    return transfer(result, [result.data]);
  }
}

// https://lorefnon.tech/2019/03/24/using-comlink-with-typescript-and-worker-loader/
expose(TifConverterWorker, self);
