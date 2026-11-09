// The image workers (src/frontend/image/SharpImages.ts) in tests: there is no window to start them in.
// Nothing tested draws images; asking for one fails, as it does when a file cannot be read.
const fail = () => Promise.reject(new Error('No image workers in tests'));

module.exports = {
  sharpImages: {
    peek: () => undefined,
    request: () => ({ promise: fail(), cancel: () => undefined }),
    drawBitmap: fail,
  },
};
