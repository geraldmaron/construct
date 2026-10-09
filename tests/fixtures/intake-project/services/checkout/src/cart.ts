export interface CartLine {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPriceMinor: number;
}

export function totalMinor(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceMinor, 0);
}
