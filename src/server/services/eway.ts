export interface Company {
  name: string;
  gstin: string;
  address: string;
}

export interface EwayInput {
  dcNumber: string;
  date: Date;
  vehicleNumber: string;
  company: Company;
  customer: { name: string; gstin?: string | null; address?: string | null };
  items: { name: string; hsnCode?: string | null; qty: number; uom: string; unitPrice?: number | null }[];
}

export interface EwayData {
  supplyType: "O";
  docType: "CHL";
  docNo: string;
  docDate: string; // dd/mm/yyyy, as the portal expects
  fromGstin: string;
  fromTrdName: string;
  toGstin: string;
  toTrdName: string;
  vehicleNo: string;
  totalValue: number;
  itemList: { productName: string; hsnCode: string; quantity: number; qtyUnit: string; taxableAmount: number }[];
  missing: string[]; // fields the portal needs that master data doesn't have yet
}

const ddmmyyyy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const money = (n: number) => Math.round(n * 100) / 100;

// Delivery-challan e-way bill data for upload/API hand-off. It lists, rather than hides, anything master data
// is still missing, because an e-way bill with a blank GSTIN or HSN will be rejected by the portal.
export function buildEwayData(i: EwayInput): EwayData {
  const missing: string[] = [];
  if (!i.company.gstin) missing.push("Company GSTIN (set COMPANY_GSTIN)");
  if (!i.customer.gstin) missing.push(`GSTIN for ${i.customer.name}`);
  if (!i.vehicleNumber.trim()) missing.push("Vehicle number");

  const itemList = i.items.map((it) => {
    if (!it.hsnCode) missing.push(`HSN code for ${it.name}`);
    if (it.unitPrice === null || it.unitPrice === undefined) missing.push(`Unit price for ${it.name}`);
    return {
      productName: it.name, hsnCode: it.hsnCode ?? "", quantity: it.qty, qtyUnit: it.uom,
      taxableAmount: money(it.qty * (it.unitPrice ?? 0)),
    };
  });

  return {
    supplyType: "O", docType: "CHL", docNo: i.dcNumber, docDate: ddmmyyyy(i.date),
    fromGstin: i.company.gstin, fromTrdName: i.company.name,
    toGstin: i.customer.gstin ?? "", toTrdName: i.customer.name,
    vehicleNo: i.vehicleNumber.replace(/\s+/g, "").toUpperCase(),
    totalValue: money(itemList.reduce((s, x) => s + x.taxableAmount, 0)),
    itemList, missing: [...new Set(missing)],
  };
}
