import { money } from "@/lib/format";

type BasisStatus = {
  basisEstimated: boolean;
  missingBasisValue: number | null;
};

export function basisWarningText(status: BasisStatus) {
  if (!status.basisEstimated) return "";
  if (status.missingBasisValue === null)
    return "Cost basis is incomplete and the affected value is unavailable. Gains cannot be fully estimated.";
  return `Missing cost basis for ${money(status.missingBasisValue)} of this holding. That portion is treated as break-even; cost basis and gains are estimates and may be incorrect.`;
}

export default function BasisWarning({ status }: { status: BasisStatus }) {
  const message = basisWarningText(status);
  return message ? <small className="muted">{message}</small> : null;
}
