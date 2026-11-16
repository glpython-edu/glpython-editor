// The visualizer's steps as pictures (P68), for exercises in which learners
// put a few steps back in order: the workspace draws each step of a range
// off-screen (`.visualizer-snapshot` in style.css, which leaves out what
// gives the order away: the marking of what comes next, what has just
// changed, the current and the executed lines, the current box's own
// variable row, animations; arrows, step bar, footer and console aren't
// drawn there at all), and this turns them into PNGs of one size and zips
// them as 00.png (before the start), 01.png, … - the step counter's numbers.
// html-to-image and fflate are loaded on the first click only.

// Sharp on a projector and in exam.net: a 700px wide step is 1400px wide.
export const STEP_IMAGE_PIXEL_RATIO = 2

// The counter's number as a file name, padded to the range's widest
// number, at least two digits: 07.png, …, 123.png.
export function stepImageName(number: number, last: number): string {
  return `${String(number).padStart(Math.max(2, String(last).length), '0')}.png`
}

export type StepImage = { name: string; frame: HTMLElement }

// Every frame as a PNG of the same size (its own background filling what
// it doesn't cover), zipped. `onProgress` gets the number of pictures done;
// `cancelled` stops between two of them, with null.
export async function zipStepImages(images: StepImage[], { width, height, background, onProgress, cancelled }: { width: number; height: number; background: string; onProgress: (done: number) => void; cancelled: () => boolean }): Promise<Blob | null> {
  const [{ toBlob }, { zipSync }] = await Promise.all([import('html-to-image'), import('fflate')])
  const files: Record<string, Uint8Array> = {}
  for (const [index, { name, frame }] of images.entries()) {
    if (cancelled()) return null
    // The code font is the system's (--glp-font-code), so no font has to be
    // embedded; skipping that also keeps html-to-image from reading the
    // host's cross-origin stylesheets.
    const png = await toBlob(frame, { width, height, pixelRatio: STEP_IMAGE_PIXEL_RATIO, backgroundColor: background, skipFonts: true })
    if (!png) throw new Error(`no picture of ${name}`)
    files[name] = new Uint8Array(await png.arrayBuffer())
    onProgress(index + 1)
  }
  if (cancelled()) return null
  // PNGs are compressed already.
  return new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' })
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
