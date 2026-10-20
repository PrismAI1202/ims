// Our own legal identity for delivery challans and e-way bills. Set these in .env; the e-way bill data
// lists anything still missing instead of emitting blanks.
export const company = {
  name: process.env.COMPANY_NAME ?? "Your Company Name",
  gstin: process.env.COMPANY_GSTIN ?? "",
  address: process.env.COMPANY_ADDRESS ?? "",
};
