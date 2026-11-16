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

// Space right of the widest step's content (P68b: the pictures are cropped
// to it, since a course or exam.net scales a picture to its column).
export const STEP_IMAGE_MARGIN = 12

// What is on one line in the step stays on one line in its picture. The
// picture is a copy with each element's computed width fixed (rounded),
// drawn at the pixel ratio: its parts can add up to a fraction more than
// that width. A variable row (a wrapping flex box exactly as wide as name
// and value) then put its value on a line of its own, below the row, and a
// value with `overflow-wrap: anywhere` ('+') broke after every character
// (P68b). So a wrapping flex box whose items are on one line in the step,
// and every element whose text - its own and its descendants' - is on one
// line, gets no line break. The step's own layout doesn't change: they are
// on one line already.
export function keepLinesWhole(frame: HTMLElement) {
  for (const element of [frame, ...frame.querySelectorAll<HTMLElement>('*')]) {
    if (getComputedStyle(element).flexWrap !== 'wrap') continue
    const tops = new Set([...element.children].filter((child) => getComputedStyle(child).position !== 'absolute').map((child) => Math.round(child.getBoundingClientRect().top)))
    if (tops.size <= 1) element.style.flexWrap = 'nowrap'
  }
  keepTextOnOneLine(frame)
}

function keepTextOnOneLine(frame: HTMLElement) {
  const range = document.createRange()
  const lineTops = (element: Element) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) tops.add(Math.round(rect.top))
      if (tops.size > 1) break
    }
    return tops.size
  }
  for (const element of [frame, ...frame.querySelectorAll<HTMLElement>('*')]) {
    const style = getComputedStyle(element)
    if (style.getPropertyValue('text-wrap-mode') === 'nowrap' || style.whiteSpace === 'pre' || style.whiteSpace === 'nowrap') continue
    if (lineTops(element) !== 1) continue
    element.style.whiteSpace = style.getPropertyValue('white-space-collapse') === 'preserve' ? 'pre' : 'nowrap'
  }
}

// How far right the step's content reaches, from the frame's left edge:
// its text, the boxes' borders, trees and their edges - not the blocks that
// span the whole width (lines, rows of the module's frame).
export function contentRight(frame: HTMLElement): number {
  const left = frame.getBoundingClientRect().left
  let right = 0
  const range = document.createRange()
  const walker = document.createTreeWalker(frame, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue
    range.selectNodeContents(node)
    right = Math.max(right, range.getBoundingClientRect().right - left)
  }
  for (const element of frame.querySelectorAll('.frame-box:not(.frame-box--root), .frame-tree, svg')) right = Math.max(right, element.getBoundingClientRect().right - left)
  return right
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
