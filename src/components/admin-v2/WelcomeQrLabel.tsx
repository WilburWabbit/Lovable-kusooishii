/**
 * WelcomeQrLabel
 *
 * Printable thermal label (102mm wide) for eBay parcel inserts.
 * Contains QR code linking to /welcome/:code, the URL in text,
 * and small reference info (eBay order ID, SKU, postcode) for admin use.
 *
 * Designed for black-and-white thermal roll printers (102mm / ~4" wide).
 * Renders in a print-optimised dialog that triggers window.print().
 */

import { useRef } from "react";
import QRCode from "react-qr-code";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Printer, QrCode } from "lucide-react";

interface WelcomeQrLabelProps {
  code: string;              // e.g. "KSO-7X3M"
  promoCode: string;         // e.g. "WELCOME-7X3M"
  ebayOrderId: string;       // eBay order reference
  primarySku?: string;       // First SKU from the order
  postcode?: string;         // Shipping postcode
  buyerName?: string;        // Buyer's first name
  /** Compact trigger: just the QR icon, no label text */
  compact?: boolean;
}

export function WelcomeQrLabel({
  code,
  promoCode,
  ebayOrderId,
  primarySku,
  postcode,
  buyerName,
  compact = false,
}: WelcomeQrLabelProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const welcomeUrl = `https://kusooishii.com/welcome/${code}`;

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Welcome QR — ${code}</title>
        <style>
          @page {
            size: 102mm auto;
            margin: 2mm 3mm;
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            width: 102mm;
            background: white;
            color: black;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .label {
            display: flex;
            flex-direction: row;
            align-items: flex-start;
            gap: 3mm;
            padding: 2mm 0;
          }
          .qr-section {
            flex-shrink: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 1mm;
          }
          .qr-section svg {
            width: 28mm !important;
            height: 28mm !important;
          }
          .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            gap: 1.5mm;
          }
          .url {
            font-size: 9pt;
            font-weight: 700;
            letter-spacing: -0.02em;
            word-break: break-all;
            line-height: 1.2;
          }
          .promo-code {
            font-size: 11pt;
            font-weight: 900;
            letter-spacing: 0.05em;
            border: 1.5pt solid black;
            padding: 1mm 2mm;
            display: inline-block;
            margin-top: 0.5mm;
          }
          .tagline {
            font-size: 7.5pt;
            font-weight: 400;
            line-height: 1.3;
            margin-top: 0.5mm;
          }
          .ref-info {
            font-size: 6pt;
            color: #666;
            line-height: 1.4;
            margin-top: auto;
            padding-top: 1mm;
            border-top: 0.5pt solid #ccc;
          }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="qr-section">
            ${printContent.querySelector('.qr-container')?.innerHTML || ''}
          </div>
          <div class="main-content">
            <div class="url">kusooishii.com/welcome/${code}</div>
            <div class="promo-code">${promoCode}</div>
            <div class="tagline">
              5% off your first order<br/>
              on kusooishii.com
            </div>
            <div class="ref-info">
              ${ebayOrderId}${primarySku ? ' · ' + primarySku : ''}${postcode ? ' · ' + postcode : ''}
            </div>
          </div>
        </div>
      </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    // Allow a moment for QR SVG to render
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="icon" title="Print welcome QR label">
            <QrCode className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5">
            <QrCode className="h-3.5 w-3.5" />
            Welcome QR
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Welcome QR Label</DialogTitle>
        </DialogHeader>

        {/* Preview (approximate screen rendering of the label) */}
        <div className="border rounded-lg p-4 bg-white" ref={printRef}>
          <div className="flex gap-4 items-start">
            <div className="qr-container flex-shrink-0">
              <QRCode
                value={welcomeUrl}
                size={112}
                level="M"
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <p className="text-xs font-bold text-black break-all leading-tight">
                kusooishii.com/welcome/{code}
              </p>
              <span className="text-sm font-black tracking-wider border-2 border-black px-2 py-0.5 inline-block text-black">
                {promoCode}
              </span>
              <p className="text-[10px] text-gray-700 leading-snug mt-0.5">
                5% off your first order<br />on kusooishii.com
              </p>
              <p className="text-[9px] text-gray-400 mt-auto pt-1 border-t border-gray-200">
                {ebayOrderId}
                {primarySku && <> · {primarySku}</>}
                {postcode && <> · {postcode}</>}
              </p>
            </div>
          </div>
        </div>

        {/* Metadata for admin reference */}
        {buyerName && (
          <p className="text-xs text-muted-foreground">
            Buyer: {buyerName}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            Print Label
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
