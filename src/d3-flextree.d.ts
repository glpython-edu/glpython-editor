// The part of d3-flextree's API that treeLayout.ts uses (the package ships
// no types of its own).
declare module 'd3-flextree' {
  export interface FlextreeNode<Datum> {
    data: Datum
    depth: number
    height: number
    x: number
    y: number
    readonly xSize: number
    children?: FlextreeNode<Datum>[]
    each(callback: (node: FlextreeNode<Datum>) => void): this
  }
  export interface FlextreeLayout<Datum> {
    (tree: FlextreeNode<Datum>): FlextreeNode<Datum>
    hierarchy(data: Datum): FlextreeNode<Datum>
  }
  export function flextree<Datum>(options: {
    children?: (datum: Datum) => Datum[] | null
    nodeSize?: (node: FlextreeNode<Datum>) => [number, number]
    spacing?: number | ((a: FlextreeNode<Datum>, b: FlextreeNode<Datum>) => number)
  }): FlextreeLayout<Datum>
}
