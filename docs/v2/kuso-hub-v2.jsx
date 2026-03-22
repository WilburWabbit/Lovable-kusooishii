import { useState } from "react";

const AMBER = "#F59E0B";
const TEAL = "#14B8A6";
const CHARCOAL = "#1C1C1E";
const SURFACE = "#2A2A2E";
const SURFACE_2 = "#35353A";
const SURFACE_3 = "#3F3F46";
const TEXT = "#FAFAFA";
const TEXT_MED = "#A1A1AA";
const TEXT_DIM = "#71717A";
const BORDER = "#3F3F46";
const RED = "#EF4444";
const GREEN = "#22C55E";
const BLUE = "#3B82F6";
const PURPLE = "#A855F7";

const UNIT_STATUSES = {
  purchased: { label: "Purchased", color: TEXT_DIM },
  graded: { label: "Graded", color: AMBER },
  listed: { label: "Listed", color: BLUE },
  sold: { label: "Sold", color: PURPLE },
  shipped: { label: "Shipped", color: TEAL },
  delivered: { label: "Delivered", color: GREEN },
  payout_received: { label: "Payout Received", color: GREEN },
  complete: { label: "Complete", color: TEXT_DIM },
  return_pending: { label: "Return Pending", color: RED },
  refunded: { label: "Refunded", color: RED },
  restocked: { label: "Restocked", color: AMBER },
  needs_allocation: { label: "Needs Allocation", color: AMBER },
};

const mockBatches = [
  {
    id: "PO-052", supplier: "ReturnsPal Ltd", date: "15 Mar 2026", sharedCosts: 18.00, vatRegistered: true,
    totalUnits: 10, totalCost: 215.00, ungradedCount: 4, gradedCount: 6,
    lines: [
      { mpn: "75348-1", name: "Mandalorian Fang Fighter", qtyPurchased: 4, unitCost: 19.00, units: [
        { uid: "PO052-01", grade: null, status: "purchased", landedCost: null },
        { uid: "PO052-02", grade: null, status: "purchased", landedCost: null },
        { uid: "PO052-03", grade: null, status: "purchased", landedCost: null },
        { uid: "PO052-04", grade: null, status: "purchased", landedCost: null },
      ]},
      { mpn: "10497-1", name: "Galaxy Explorer", qtyPurchased: 2, unitCost: 45.00, units: [
        { uid: "PO052-05", grade: 1, status: "listed", landedCost: 52.10 },
        { uid: "PO052-06", grade: 2, status: "graded", landedCost: 42.80 },
      ]},
      { mpn: "75367-1", name: "Republic Venator", qtyPurchased: 3, unitCost: 38.00, units: [
        { uid: "PO052-07", grade: 1, status: "sold", landedCost: 42.30 },
        { uid: "PO052-08", grade: 1, status: "listed", landedCost: 42.30 },
        { uid: "PO052-09", grade: 2, status: "graded", landedCost: 35.10 },
      ]},
      { mpn: "31208-1", name: "Hokusai – The Great Wave", qtyPurchased: 1, unitCost: 52.00, units: [
        { uid: "PO052-10", grade: 1, status: "listed", landedCost: 58.40 },
      ]},
    ],
  },
  {
    id: "PO-047", supplier: "Norfolk Toy Clearance", date: "1 Mar 2026", sharedCosts: 12.00, vatRegistered: false,
    totalUnits: 6, totalCost: 148.00, ungradedCount: 0, gradedCount: 6,
    lines: [
      { mpn: "75367-1", name: "Republic Venator", qtyPurchased: 2, unitCost: 35.00, units: [
        { uid: "PO047-01", grade: 1, status: "complete", landedCost: 38.20 },
        { uid: "PO047-02", grade: 1, status: "shipped", landedCost: 38.20 },
      ]},
      { mpn: "40220-1", name: "London Bus", qtyPurchased: 3, unitCost: 6.00, units: [
        { uid: "PO047-03", grade: 1, status: "complete", landedCost: 7.20 },
        { uid: "PO047-04", grade: 1, status: "listed", landedCost: 7.20 },
        { uid: "PO047-05", grade: 2, status: "listed", landedCost: 5.80 },
      ]},
      { mpn: "76265-1", name: "Batwing", qtyPurchased: 1, unitCost: 12.00, units: [
        { uid: "PO047-06", grade: 3, status: "listed", landedCost: 14.00 },
      ]},
    ],
  },
];

const mockProducts = [
  { mpn: "75367-1", name: "Republic Venator", theme: "Star Wars", variants: [
    { grade: 1, sku: "75367-1.1", price: "£69.99", avgCost: "£40.25", costRange: "£38.20–£42.30", qtyOnHand: 2, floorPrice: "£54.32", units: [
      { uid: "PO047-01", batch: "PO-047", status: "complete", landedCost: 38.20, order: "KO-1145", payout: "eBay 18 Mar" },
      { uid: "PO047-02", batch: "PO-047", status: "shipped", landedCost: 38.20, order: "KO-1172", payout: null },
      { uid: "PO052-07", batch: "PO-052", status: "sold", landedCost: 42.30, order: "KO-1170", payout: null },
      { uid: "PO052-08", batch: "PO-052", status: "listed", landedCost: 42.30, order: null, payout: null },
    ]},
    { grade: 2, sku: "75367-1.2", price: "£54.99", avgCost: "£35.10", costRange: "£35.10", qtyOnHand: 1, floorPrice: "£44.72", units: [
      { uid: "PO052-09", batch: "PO-052", status: "graded", landedCost: 35.10, order: null, payout: null },
    ]},
  ]},
  { mpn: "40220-1", name: "London Bus", theme: "Promotional", variants: [
    { grade: 1, sku: "40220-1.1", price: "£18.99", avgCost: "£7.20", costRange: "£7.20", qtyOnHand: 1, floorPrice: "£9.72", units: [
      { uid: "PO047-03", batch: "PO-047", status: "complete", landedCost: 7.20, order: "KO-1140", payout: "eBay 11 Mar" },
      { uid: "PO047-04", batch: "PO-047", status: "listed", landedCost: 7.20, order: null, payout: null },
    ]},
    { grade: 2, sku: "40220-1.2", price: "£14.99", avgCost: "£5.80", costRange: "£5.80", qtyOnHand: 1, floorPrice: "£7.83", units: [
      { uid: "PO047-05", batch: "PO-047", status: "listed", landedCost: 5.80, order: null, payout: null },
    ]},
  ]},
  { mpn: "75348-1", name: "Mandalorian Fang Fighter", theme: "Star Wars", variants: [] },
  { mpn: "10497-1", name: "Galaxy Explorer", theme: "Icons", variants: [
    { grade: 1, sku: "10497-1.1", price: "£109.99", avgCost: "£52.10", costRange: "£52.10", qtyOnHand: 1, floorPrice: "£66.69", units: [
      { uid: "PO052-05", batch: "PO-052", status: "listed", landedCost: 52.10, order: null, payout: null },
    ]},
    { grade: 2, sku: "10497-1.2", price: "£89.99", avgCost: "£42.80", costRange: "£42.80", qtyOnHand: 1, floorPrice: "£54.58", units: [
      { uid: "PO052-06", batch: "PO-052", status: "graded", landedCost: 42.80, order: null, payout: null },
    ]},
  ]},
];

const mockOrders = [
  { id: "KO-1172", customer: "James M.", channel: "eBay", total: "£69.99", vat: "£11.67", date: "22 Mar 2026", status: "shipped",
    items: [
      { sku: "75367-1.1", name: "Republic Venator", uid: "PO047-02", unitStatus: "shipped", tracking: "JD001234567", carrier: "Evri", landedCost: 38.20, payoutStatus: "Pending" },
    ]},
  { id: "KO-1171", customer: "Sarah K.", channel: "Website", total: "£18.99", vat: "£3.17", date: "21 Mar 2026", status: "delivered",
    items: [
      { sku: "40220-1.1", name: "London Bus", uid: "PO047-03", unitStatus: "delivered", tracking: "RM12345678GB", carrier: "Royal Mail", landedCost: 7.20, payoutStatus: "Pending" },
    ]},
  { id: "KO-1170", customer: "Cash Sales", channel: "In-person", total: "£69.99", vat: "£11.67", date: "20 Mar 2026", status: "needs_allocation",
    items: [
      { sku: null, name: "Unallocated", uid: null, unitStatus: "needs_allocation", tracking: null, carrier: null, landedCost: null, payoutStatus: null },
    ]},
  { id: "KO-1169", customer: "Mike R.", channel: "eBay", total: "£84.98", vat: "£14.16", date: "19 Mar 2026", status: "complete",
    items: [
      { sku: "75367-1.1", name: "Republic Venator", uid: "PO047-01", unitStatus: "complete", tracking: "JD001234111", carrier: "Evri", landedCost: 38.20, payoutStatus: "Received" },
      { sku: "40220-1.1", name: "London Bus", uid: "PO047-03", unitStatus: "complete", tracking: "JD001234111", carrier: "Evri", landedCost: 7.20, payoutStatus: "Received" },
    ]},
  { id: "KO-1168", customer: "Laura P.", channel: "BrickLink", total: "£67.99", vat: "£11.33", date: "17 Mar 2026", status: "return_pending",
    items: [
      { sku: "75367-1.1", name: "Republic Venator", uid: "PO052-07", unitStatus: "return_pending", tracking: "RM99887766GB", carrier: "Royal Mail", landedCost: 42.30, payoutStatus: "Held" },
    ]},
];

// ─── Shared Components ──────────────────────────────────────────────────────

const Mono = ({ children, color, size }) => (
  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: size || 12, color: color || TEXT_MED, letterSpacing: "0.02em" }}>{children}</span>
);

const Badge = ({ label, color, small }) => (
  <span style={{
    display: "inline-block", padding: small ? "1px 6px" : "2px 10px", borderRadius: 4,
    background: `${color}18`, color, fontSize: small ? 10 : 11, fontWeight: 600,
    letterSpacing: "0.03em", textTransform: "uppercase", border: `1px solid ${color}30`,
  }}>{label}</span>
);

const StatusBadge = ({ status }) => {
  const s = UNIT_STATUSES[status] || { label: status, color: TEXT_DIM };
  return <Badge label={s.label} color={s.color} small />;
};

const Pill = ({ count, active }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    minWidth: 20, height: 20, borderRadius: 10,
    background: active ? AMBER : SURFACE_3, color: active ? CHARCOAL : TEXT_DIM,
    fontSize: 11, fontWeight: 700, padding: "0 6px",
  }}>{count}</span>
);

const SidebarItem = ({ icon, label, active, onClick, count }) => (
  <button onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 16px",
    background: active ? `${AMBER}12` : "transparent", border: "none",
    borderLeft: active ? `2px solid ${AMBER}` : "2px solid transparent",
    color: active ? TEXT : TEXT_MED, cursor: "pointer", fontSize: 13,
    fontWeight: active ? 600 : 400, textAlign: "left", transition: "all 0.15s ease",
  }}>
    <span style={{ fontSize: 16, width: 20, textAlign: "center", opacity: active ? 1 : 0.6 }}>{icon}</span>
    <span style={{ flex: 1 }}>{label}</span>
    {count !== undefined && <Pill count={count} active={active} />}
  </button>
);

const Card = ({ children, style, onClick }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        background: SURFACE, border: `1px solid ${hovered && onClick ? AMBER + "40" : BORDER}`,
        borderRadius: 8, padding: 16, cursor: onClick ? "pointer" : "default",
        transition: "all 0.15s ease",
        transform: hovered && onClick ? "translateY(-1px)" : "none",
        ...style,
      }}>
      {children}
    </div>
  );
};

const SectionHead = ({ children }) => (
  <h3 style={{ fontSize: 11, color: TEXT_DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>{children}</h3>
);

const BackButton = ({ onClick, label }) => (
  <button onClick={onClick} style={{ background: "none", border: "none", color: TEXT_DIM, cursor: "pointer", fontSize: 13, padding: 0, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
    ← {label || "Back"}
  </button>
);

const GradeBadge = ({ grade, size }) => {
  const s = size || 22;
  const colors = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32", 4: TEXT_DIM };
  const c = colors[grade] || TEXT_DIM;
  return (
    <span style={{
      width: s, height: s, borderRadius: 4, display: "inline-flex",
      alignItems: "center", justifyContent: "center", fontSize: s * 0.5, fontWeight: 800,
      fontFamily: "'JetBrains Mono', monospace",
      background: `${c}20`, color: c, border: `1px solid ${c}30`,
    }}>G{grade}</span>
  );
};

const SlideOut = ({ open, onClose, title, children }) => {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "#00000060", zIndex: 100 }} />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 480, background: CHARCOAL,
        borderLeft: `1px solid ${BORDER}`, zIndex: 101, display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px #00000060", animation: "slideIn 0.2s ease",
      }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: TEXT, margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", color: TEXT_DIM, cursor: "pointer", fontSize: 18 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>{children}</div>
      </div>
    </>
  );
};

const UnitLifecycle = ({ status }) => {
  const steps = ["Purchased", "Graded", "Listed", "Sold", "Shipped", "Delivered", "Payout Received", "Complete"];
  const statusOrder = ["purchased","graded","listed","sold","shipped","delivered","payout_received","complete"];
  const currentIdx = statusOrder.indexOf(status);
  const isReturn = status === "return_pending" || status === "refunded";
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {steps.map((step, i) => {
        const done = i <= currentIdx && !isReturn;
        const active = i === currentIdx && !isReturn;
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
            <div style={{
              width: 18, height: 18, borderRadius: 9,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: done ? `${GREEN}20` : active ? `${AMBER}20` : SURFACE_3,
              border: `2px solid ${done ? GREEN : active ? AMBER : BORDER}`,
              color: done ? GREEN : TEXT_DIM, fontSize: 9, fontWeight: 700,
            }}>{done ? "✓" : ""}</div>
            <span style={{ fontSize: 12, color: done ? TEXT : active ? AMBER : TEXT_DIM, fontWeight: active ? 600 : 400 }}>{step}</span>
          </div>
        );
      })}
      {isReturn && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", marginTop: 4, borderTop: `1px solid ${RED}30` }}>
          <div style={{ width: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: `${RED}20`, border: `2px solid ${RED}`, color: RED, fontSize: 9, fontWeight: 700 }}>!</div>
          <span style={{ fontSize: 12, color: RED, fontWeight: 600 }}>{status === "return_pending" ? "Return Pending" : "Refunded"}</span>
        </div>
      )}
    </div>
  );
};

const GradeSlideOut = ({ unit, onClose }) => (
  <SlideOut open={!!unit} onClose={onClose} title={unit ? `Grade Unit ${unit.uid}` : ""}>
    {unit && (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", gap: 12, fontSize: 13, color: TEXT_DIM }}>
          <span>MPN: <Mono color={AMBER}>{unit.mpn || "—"}</Mono></span>
          {unit.name && <span>{unit.name}</span>}
        </div>
        <div>
          <SectionHead>Assign Grade</SectionHead>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { grade: 1, name: "Mint Brick", desc: "Factory sealed, untouched" },
              { grade: 2, name: "Full Stack", desc: "Opened but complete" },
              { grade: 3, name: "Well Bricked", desc: "Built/used, still complete" },
              { grade: 4, name: "Brick Shy", desc: "Incomplete, all issues disclosed" },
            ].map(g => {
              const colors = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32", 4: TEXT_DIM };
              const c = colors[g.grade];
              const selected = unit.grade === g.grade;
              return (
                <button key={g.grade} style={{
                  padding: 14, background: selected ? `${c}15` : SURFACE_2,
                  border: `2px solid ${selected ? c : BORDER}`, borderRadius: 8, cursor: "pointer", textAlign: "left",
                }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: c, fontFamily: "'JetBrains Mono', monospace" }}>G{g.grade}</div>
                  <div style={{ fontSize: 12, color: TEXT, fontWeight: 600, marginTop: 2 }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2 }}>{g.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <SectionHead>Condition Flags</SectionHead>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {["Resealed", "Shelf wear", "Box dent", "Box crush", "Missing outer carton", "Bags opened", "Parts verified", "Sun yellowing", "Price sticker residue"].map(f => (
              <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: TEXT_MED, cursor: "pointer", padding: "4px 0" }}>
                <input type="checkbox" style={{ accentColor: AMBER }} /> {f}
              </label>
            ))}
          </div>
        </div>
        <div>
          <SectionHead>Physical Confirmation</SectionHead>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {[{ label: "EAN", placeholder: "5702017421384" }, { label: "Age Mark", placeholder: "14+" }, { label: "Dimensions (cm)", placeholder: "38 × 26 × 7" }, { label: "Weight (g)", placeholder: "1250" }].map(f => (
              <div key={f.label}>
                <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>{f.label}</label>
                <input placeholder={f.placeholder} style={{ width: "100%", padding: "7px 9px", background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13, boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
          <button style={{ flex: 1, background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save Grade</button>
          <button onClick={onClose} style={{ padding: "10px 16px", background: SURFACE_3, color: TEXT_MED, border: `1px solid ${BORDER}`, borderRadius: 6, fontSize: 13, cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    )}
  </SlideOut>
);

const UnitDetailSlideOut = ({ unit, onClose }) => (
  <SlideOut open={!!unit} onClose={onClose} title={unit ? `Unit ${unit.uid}` : ""}>
    {unit && (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {[
            { label: "SKU", value: unit.sku || "—" },
            { label: "Grade", value: unit.grade ? `G${unit.grade}` : "Ungraded" },
            { label: "Batch", value: unit.batch },
            { label: "Landed Cost", value: unit.landedCost ? `£${unit.landedCost.toFixed(2)}` : "—" },
            { label: "Order", value: unit.order || "—" },
            { label: "Payout", value: unit.payout || (unit.order ? "Pending" : "—") },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize: 10, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</div>
              <Mono color={f.label === "Landed Cost" ? TEAL : f.label === "SKU" || f.label === "Order" ? AMBER : TEXT_MED} size={14}>{f.value}</Mono>
            </div>
          ))}
        </div>
        <div>
          <SectionHead>Lifecycle</SectionHead>
          <UnitLifecycle status={unit.status} />
        </div>
        {unit.grade !== null && (
          <div>
            <SectionHead>Edit Grade</SectionHead>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {[1,2,3,4].map(g => {
                const colors = { 1: "#FFD700", 2: "#C0C0C0", 3: "#CD7F32", 4: TEXT_DIM };
                return (
                  <button key={g} style={{
                    padding: 8, borderRadius: 6, cursor: "pointer", textAlign: "center",
                    background: unit.grade === g ? `${colors[g]}20` : SURFACE_3,
                    border: `2px solid ${unit.grade === g ? colors[g] : BORDER}`,
                    color: colors[g], fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 800,
                  }}>G{g}</button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: `1px solid ${BORDER}` }}>
          <button style={{ flex: 1, background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "10px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Save Changes</button>
        </div>
      </div>
    )}
  </SlideOut>
);

// ─── Purchases ───────────────────────────────────────────────────────────────

const BatchList = ({ onSelectBatch }) => {
  const totalUngraded = mockBatches.reduce((sum, b) => sum + b.ungradedCount, 0);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>Purchases</h1>
        <button style={{ background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ New Purchase</button>
      </div>
      <p style={{ color: TEXT_DIM, fontSize: 13, margin: "4px 0 20px" }}>
        Purchase batches and goods-in grading. {totalUngraded > 0 && <span style={{ color: AMBER }}>{totalUngraded} units awaiting grading.</span>}
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {mockBatches.map(b => (
          <Card key={b.id} onClick={() => onSelectBatch(b)} style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Mono color={AMBER} size={14}>{b.id}</Mono>
                <span style={{ color: TEXT, fontWeight: 500, fontSize: 14 }}>{b.supplier}</span>
                <span style={{ color: TEXT_DIM, fontSize: 12 }}>{b.date}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {b.ungradedCount > 0 && <Badge label={`${b.ungradedCount} ungraded`} color={AMBER} />}
                {b.ungradedCount === 0 && <Badge label="All graded" color={GREEN} small />}
                <Mono color={TEAL}>£{b.totalCost.toFixed(2)}</Mono>
              </div>
            </div>
            <div style={{ padding: "0 16px 12px", display: "flex", gap: 16, fontSize: 12, color: TEXT_DIM }}>
              <span>{b.totalUnits} units</span>
              <span>{b.lines.length} MPNs</span>
              <span>Shared: £{b.sharedCosts.toFixed(2)}</span>
              {b.vatRegistered && <span style={{ color: TEAL }}>VAT reg. supplier</span>}
            </div>
            <div style={{ display: "flex", height: 3 }}>
              {(() => {
                const allUnits = b.lines.flatMap(l => l.units);
                const counts = {};
                allUnits.forEach(u => { counts[u.status] = (counts[u.status] || 0) + 1; });
                return Object.entries(counts).map(([status, count]) => (
                  <div key={status} style={{ flex: count, background: UNIT_STATUSES[status]?.color || TEXT_DIM, opacity: 0.6 }} />
                ));
              })()}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

const BatchDetail = ({ batch, onBack }) => {
  const [gradingUnit, setGradingUnit] = useState(null);
  const [selectedUnits, setSelectedUnits] = useState(new Set());
  const toggleSelect = (uid) => setSelectedUnits(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });
  const allUnits = batch.lines.flatMap(l => l.units.map(u => ({ ...u, mpn: l.mpn, name: l.name, unitCost: l.unitCost })));
  const ungraded = allUnits.filter(u => u.grade === null);

  return (
    <div>
      <BackButton onClick={onBack} label="Back to purchases" />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>{batch.id}</h1>
            {ungraded.length > 0 ? <Badge label={`${ungraded.length} ungraded`} color={AMBER} /> : <Badge label="All graded" color={GREEN} />}
          </div>
          <div style={{ display: "flex", gap: 16, color: TEXT_DIM, fontSize: 13 }}>
            <span>{batch.supplier}</span><span>{batch.date}</span><span>Total: <Mono color={TEAL}>£{batch.totalCost.toFixed(2)}</Mono></span>
          </div>
        </div>
        {selectedUnits.size > 0 && (
          <button style={{ background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Bulk Grade {selectedUnits.size} Units
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total Units", value: batch.totalUnits, color: TEXT },
          { label: "Shared Costs", value: `£${batch.sharedCosts.toFixed(2)}`, color: TEXT_MED },
          { label: "Batch Cost", value: `£${batch.totalCost.toFixed(2)}`, color: TEAL },
          { label: "Ungraded", value: ungraded.length, color: ungraded.length > 0 ? AMBER : GREEN },
        ].map(s => (
          <Card key={s.label} style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </Card>
        ))}
      </div>

      {batch.lines.map(line => (
        <Card key={line.mpn} style={{ marginBottom: 12, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Mono color={AMBER}>{line.mpn}</Mono>
              <span style={{ color: TEXT, fontWeight: 500 }}>{line.name}</span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 12, color: TEXT_DIM }}>
              <span>Qty: {line.qtyPurchased}</span><span>Unit cost: <Mono>£{line.unitCost.toFixed(2)}</Mono></span>
            </div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <th style={{ padding: "8px 12px", width: 32 }}></th>
                {["Unit ID", "Grade", "Status", "Landed Cost", ""].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {line.units.map(u => (
                <tr key={u.uid} style={{ borderBottom: `1px solid ${BORDER}`, background: u.grade === null ? `${AMBER}06` : "transparent" }}>
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    {u.grade === null && <input type="checkbox" checked={selectedUnits.has(u.uid)} onChange={() => toggleSelect(u.uid)} style={{ accentColor: AMBER, cursor: "pointer" }} />}
                  </td>
                  <td style={{ padding: "8px 12px" }}><Mono color={TEXT_MED}>{u.uid}</Mono></td>
                  <td style={{ padding: "8px 12px" }}>
                    {u.grade ? <GradeBadge grade={u.grade} size={20} /> : <span style={{ fontSize: 12, color: AMBER, fontStyle: "italic" }}>Awaiting grading</span>}
                  </td>
                  <td style={{ padding: "8px 12px" }}><StatusBadge status={u.status} /></td>
                  <td style={{ padding: "8px 12px" }}><Mono color={u.landedCost ? TEAL : TEXT_DIM}>{u.landedCost ? `£${u.landedCost.toFixed(2)}` : "—"}</Mono></td>
                  <td style={{ padding: "8px 12px" }}>
                    <button onClick={(e) => { e.stopPropagation(); setGradingUnit({ ...u, mpn: line.mpn, name: line.name }); }} style={{
                      background: u.grade === null ? AMBER : "none", color: u.grade === null ? CHARCOAL : TEXT_DIM,
                      border: u.grade === null ? "none" : `1px solid ${BORDER}`, borderRadius: 4,
                      padding: "4px 10px", fontSize: 11, fontWeight: u.grade === null ? 700 : 400, cursor: "pointer",
                    }}>{u.grade === null ? "Grade" : "Edit"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
      <GradeSlideOut unit={gradingUnit} onClose={() => setGradingUnit(null)} />
    </div>
  );
};

// ─── Products ────────────────────────────────────────────────────────────────

const ProductList = ({ onSelectProduct }) => (
  <div>
    <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: "0 0 4px" }}>Products</h1>
    <p style={{ color: TEXT_DIM, fontSize: 13, margin: "0 0 20px" }}>{mockProducts.length} products (MPN level)</p>
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["MPN", "Product", "Theme", "Variants", "Total Units", "Listed", "Sold", "Status"].map(h => (
              <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {mockProducts.map(p => {
            const allUnits = p.variants.flatMap(v => v.units);
            const listed = allUnits.filter(u => u.status === "listed").length;
            const sold = allUnits.filter(u => ["sold","shipped","delivered","payout_received","complete"].includes(u.status)).length;
            const noVariants = p.variants.length === 0;
            return (
              <tr key={p.mpn} onClick={() => onSelectProduct(p)} style={{ borderBottom: `1px solid ${BORDER}`, cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.background = SURFACE_2} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "10px 12px" }}><Mono color={AMBER}>{p.mpn}</Mono></td>
                <td style={{ padding: "10px 12px", color: TEXT, fontWeight: 500 }}>{p.name}</td>
                <td style={{ padding: "10px 12px", color: TEXT_MED }}>{p.theme}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", gap: 4 }}>
                    {p.variants.length > 0 ? p.variants.map(v => <GradeBadge key={v.grade} grade={v.grade} size={20} />) : <span style={{ color: TEXT_DIM, fontSize: 12 }}>—</span>}
                  </div>
                </td>
                <td style={{ padding: "10px 12px" }}><Mono>{allUnits.length || "—"}</Mono></td>
                <td style={{ padding: "10px 12px" }}><Mono color={listed > 0 ? BLUE : TEXT_DIM}>{listed}</Mono></td>
                <td style={{ padding: "10px 12px" }}><Mono color={sold > 0 ? GREEN : TEXT_DIM}>{sold}</Mono></td>
                <td style={{ padding: "10px 12px" }}>{noVariants ? <Badge label="Ungraded" color={AMBER} small /> : <Badge label={`${p.variants.length} active`} color={GREEN} small />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  </div>
);

const ProductDetail = ({ product, onBack }) => {
  const [activeTab, setActiveTab] = useState("stock");
  const [slideUnit, setSlideUnit] = useState(null);
  const [selectedUnits, setSelectedUnits] = useState(new Set());
  const allUnits = product.variants.flatMap(v => v.units.map(u => ({ ...u, grade: v.grade, sku: v.sku, price: v.price })));
  const toggleUnit = (uid) => setSelectedUnits(prev => { const n = new Set(prev); n.has(uid) ? n.delete(uid) : n.add(uid); return n; });

  const tabs = [
    { key: "stock", label: "Stock Units", count: allUnits.length },
    { key: "copy", label: "Copy & Media" },
    { key: "channels", label: "Channels" },
    { key: "specs", label: "Specifications" },
  ];

  return (
    <div>
      <BackButton onClick={onBack} label="Back to products" />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>{product.name}</h1>
            <Mono color={AMBER} size={14}>{product.mpn}</Mono>
          </div>
          <div style={{ color: TEXT_DIM, fontSize: 13 }}>Theme: {product.theme}</div>
        </div>
        {selectedUnits.size > 0 && (
          <button style={{ background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Bulk Edit {selectedUnits.size} Units
          </button>
        )}
      </div>

      {product.variants.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(product.variants.length, 4)}, 1fr)`, gap: 12, marginBottom: 20 }}>
          {product.variants.map(v => {
            const listed = v.units.filter(u => u.status === "listed").length;
            const sold = v.units.filter(u => ["sold","shipped","delivered","payout_received","complete"].includes(u.status)).length;
            return (
              <Card key={v.sku} style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <Mono color={AMBER} size={13}>{v.sku}</Mono>
                  <GradeBadge grade={v.grade} size={26} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>Price</div><Mono color={TEAL} size={14}>{v.price}</Mono></div>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>Avg Cost</div><Mono size={14}>{v.avgCost}</Mono></div>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>Floor</div><Mono color={RED} size={14}>{v.floorPrice}</Mono></div>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>On Hand</div><Mono size={14}>{v.qtyOnHand}</Mono></div>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>Cost Range</div><Mono size={11}>{v.costRange}</Mono></div>
                  <div><div style={{ fontSize: 10, color: TEXT_DIM }}>Listed / Sold</div><Mono size={14}><span style={{ color: BLUE }}>{listed}</span> / <span style={{ color: GREEN }}>{sold}</span></Mono></div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${BORDER}`, marginBottom: 20 }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: "10px 16px", background: "none", border: "none",
            borderBottom: activeTab === t.key ? `2px solid ${AMBER}` : "2px solid transparent",
            color: activeTab === t.key ? TEXT : TEXT_DIM, fontSize: 13,
            fontWeight: activeTab === t.key ? 600 : 400, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
          }}>
            {t.label}
            {t.count !== undefined && <span style={{ fontSize: 11, color: TEXT_DIM, background: SURFACE_3, padding: "1px 6px", borderRadius: 8 }}>{t.count}</span>}
          </button>
        ))}
      </div>

      {activeTab === "stock" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                <th style={{ padding: "8px 10px", width: 32 }}></th>
                {["Unit ID", "Grade", "Batch", "Landed Cost", "Status", "Order", "Payout", ""].map(h => (
                  <th key={h} style={{ padding: "8px 10px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allUnits.map(u => (
                <tr key={u.uid} style={{ borderBottom: `1px solid ${BORDER}`, background: u.status === "return_pending" ? `${RED}08` : "transparent" }}>
                  <td style={{ padding: "8px 10px", textAlign: "center" }}>
                    <input type="checkbox" checked={selectedUnits.has(u.uid)} onChange={() => toggleUnit(u.uid)} style={{ accentColor: AMBER, cursor: "pointer" }} />
                  </td>
                  <td style={{ padding: "8px 10px" }}><Mono color={TEXT_MED}>{u.uid}</Mono></td>
                  <td style={{ padding: "8px 10px" }}><GradeBadge grade={u.grade} size={20} /></td>
                  <td style={{ padding: "8px 10px" }}><Mono color={TEXT_DIM}>{u.batch}</Mono></td>
                  <td style={{ padding: "8px 10px" }}><Mono color={TEAL}>£{u.landedCost.toFixed(2)}</Mono></td>
                  <td style={{ padding: "8px 10px" }}><StatusBadge status={u.status} /></td>
                  <td style={{ padding: "8px 10px" }}>{u.order ? <Mono color={AMBER}>{u.order}</Mono> : <span style={{ color: TEXT_DIM }}>—</span>}</td>
                  <td style={{ padding: "8px 10px" }}>
                    {u.payout ? <Mono color={GREEN}>{u.payout}</Mono> : u.order ? <span style={{ color: AMBER, fontSize: 11 }}>Pending</span> : <span style={{ color: TEXT_DIM }}>—</span>}
                  </td>
                  <td style={{ padding: "8px 10px" }}>
                    <button onClick={() => setSlideUnit(u)} style={{ background: "none", color: TEXT_DIM, border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {activeTab === "copy" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Card>
            <SectionHead>Photos</SectionHead>
            <div style={{ border: `2px dashed ${BORDER}`, borderRadius: 8, padding: 40, textAlign: "center", color: TEXT_DIM, fontSize: 13 }}>
              Drop images here or click to upload<div style={{ fontSize: 11, marginTop: 4 }}>Alt text generated automatically</div>
            </div>
          </Card>
          <Card>
            <SectionHead>Product Copy (MPN level)</SectionHead>
            <div style={{ display: "grid", gap: 12 }}>
              {[{ label: "Hook", lines: 2 }, { label: "Description", lines: 4 }, { label: "Highlights", lines: 3 }, { label: "CTA", lines: 1 }].map(f => (
                <div key={f.label}>
                  <label style={{ fontSize: 10, color: TEXT_DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 3 }}>{f.label}</label>
                  <textarea rows={f.lines} style={{ width: "100%", background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13, padding: 10, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                </div>
              ))}
            </div>
          </Card>
          {product.variants.map(v => (
            <Card key={v.sku}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <SectionHead>Condition Notes</SectionHead>
                <Mono color={AMBER} size={11}>{v.sku}</Mono>
                <GradeBadge grade={v.grade} size={18} />
              </div>
              <textarea rows={3} placeholder="AI-drafted from grade + flags + photos" style={{ width: "100%", background: SURFACE_2, border: `1px solid ${BORDER}`, borderRadius: 4, color: TEXT, fontSize: 13, padding: 10, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </Card>
          ))}
        </div>
      )}

      {activeTab === "channels" && (
        <div style={{ display: "grid", gap: 16 }}>
          {product.variants.map(v => (
            <Card key={v.sku}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Mono color={AMBER} size={14}>{v.sku}</Mono>
                  <GradeBadge grade={v.grade} size={22} />
                  <Mono color={TEAL}>{v.price}</Mono>
                </div>
                <button style={{ background: GREEN, color: CHARCOAL, border: "none", borderRadius: 6, padding: "6px 14px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Publish All</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {["eBay", "Website", "BrickLink"].map(ch => (
                  <div key={ch} style={{ padding: 12, background: SURFACE_2, borderRadius: 6, border: `1px solid ${BORDER}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{ch}</span>
                      <Badge label="Draft" color={AMBER} small />
                    </div>
                    <button style={{ width: "100%", padding: "6px", background: SURFACE_3, color: TEXT_MED, border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 11, cursor: "pointer" }}>Publish</button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {activeTab === "specs" && (
        <Card>
          <SectionHead>Product Specifications</SectionHead>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
            {[["Set Number", product.mpn.split('-')[0]], ["Theme", product.theme], ["Pieces", "To be confirmed"], ["Age Mark", "To be confirmed"], ["EAN", "To be confirmed"], ["Released", "To be confirmed"], ["Retired", "To be confirmed"], ["Dimensions", "To be confirmed"]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${BORDER}`, marginRight: 16 }}>
                <span style={{ color: TEXT_DIM, fontSize: 13 }}>{k}</span>
                <span style={{ color: v === "To be confirmed" ? `${AMBER}90` : TEXT, fontSize: 13 }}>{v}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <UnitDetailSlideOut unit={slideUnit} onClose={() => setSlideUnit(null)} />
    </div>
  );
};

// ─── Orders ──────────────────────────────────────────────────────────────────

const OrderList = ({ onSelectOrder }) => {
  const actionNeeded = mockOrders.filter(o => ["needs_allocation","return_pending"].includes(o.status)).length;
  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: "0 0 4px" }}>Orders</h1>
      <p style={{ color: TEXT_DIM, fontSize: 13, margin: "0 0 20px" }}>
        {mockOrders.length} orders {actionNeeded > 0 && <span style={{ color: AMBER }}>· {actionNeeded} need attention</span>}
      </p>
      <Card style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {["Order", "Customer", "Channel", "Items", "Total", "VAT", "Status", "Date"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mockOrders.map(o => {
              const alert = ["needs_allocation", "return_pending"].includes(o.status);
              return (
                <tr key={o.id} onClick={() => onSelectOrder(o)} style={{ borderBottom: `1px solid ${BORDER}`, cursor: "pointer", background: alert ? `${AMBER}06` : "transparent" }}
                  onMouseEnter={e => e.currentTarget.style.background = SURFACE_2} onMouseLeave={e => e.currentTarget.style.background = alert ? `${AMBER}06` : "transparent"}>
                  <td style={{ padding: "10px 12px" }}><Mono color={AMBER}>{o.id}</Mono></td>
                  <td style={{ padding: "10px 12px", color: TEXT }}>
                    {o.customer}{o.customer === "Cash Sales" && <span style={{ fontSize: 10, color: AMBER, marginLeft: 6 }}>⚠ Allocate</span>}
                  </td>
                  <td style={{ padding: "10px 12px", color: TEXT_MED }}>{o.channel}</td>
                  <td style={{ padding: "10px 12px", color: TEXT_MED }}>{o.items.length}</td>
                  <td style={{ padding: "10px 12px" }}><Mono color={TEAL}>{o.total}</Mono></td>
                  <td style={{ padding: "10px 12px" }}><Mono color={TEXT_DIM}>{o.vat}</Mono></td>
                  <td style={{ padding: "10px 12px" }}><StatusBadge status={o.status} /></td>
                  <td style={{ padding: "10px 12px", color: TEXT_DIM }}>{o.date}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

const OrderDetail = ({ order, onBack }) => {
  const [slideUnit, setSlideUnit] = useState(null);
  return (
    <div>
      <BackButton onClick={onBack} label="Back to orders" />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: 0 }}>{order.id}</h1>
            <StatusBadge status={order.status} />
          </div>
          <div style={{ display: "flex", gap: 16, color: TEXT_DIM, fontSize: 13 }}>
            <span>{order.customer}</span><span>{order.channel}</span><span>{order.date}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {order.status === "needs_allocation" && <button style={{ background: AMBER, color: CHARCOAL, border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>Allocate Items</button>}
          {["shipped","delivered"].includes(order.status) && <button style={{ background: SURFACE_3, color: TEXT_MED, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>Mark Complete</button>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Total", value: order.total, color: TEAL },
          { label: "VAT", value: order.vat, color: TEXT_MED },
          { label: "Net", value: "£" + (parseFloat(order.total.replace("£","")) - parseFloat(order.vat.replace("£",""))).toFixed(2), color: TEXT },
          { label: "QBO", value: "Synced", color: GREEN },
        ].map(s => (
          <Card key={s.label} style={{ padding: 12 }}>
            <div style={{ fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}><SectionHead>Line Items → Stock Units</SectionHead></div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
              {["SKU", "Product", "Unit ID", "Landed Cost", "Status", "Tracking", "Payout", ""].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${BORDER}`, background: item.unitStatus === "return_pending" ? `${RED}08` : item.unitStatus === "needs_allocation" ? `${AMBER}08` : "transparent" }}>
                <td style={{ padding: "10px 12px" }}><Mono color={item.sku ? AMBER : TEXT_DIM}>{item.sku || "—"}</Mono></td>
                <td style={{ padding: "10px 12px", color: TEXT }}>{item.name}</td>
                <td style={{ padding: "10px 12px" }}><Mono color={item.uid ? TEXT_MED : AMBER}>{item.uid || "Unallocated"}</Mono></td>
                <td style={{ padding: "10px 12px" }}><Mono color={item.landedCost ? TEAL : TEXT_DIM}>{item.landedCost ? `£${item.landedCost.toFixed(2)}` : "—"}</Mono></td>
                <td style={{ padding: "10px 12px" }}><StatusBadge status={item.unitStatus} /></td>
                <td style={{ padding: "10px 12px" }}><Mono color={TEXT_DIM} size={11}>{item.tracking || "—"}</Mono></td>
                <td style={{ padding: "10px 12px" }}>
                  {item.payoutStatus === "Received" ? <Badge label="Received" color={GREEN} small /> :
                   item.payoutStatus === "Pending" ? <Badge label="Pending" color={AMBER} small /> :
                   item.payoutStatus === "Held" ? <Badge label="Held" color={RED} small /> : <span style={{ color: TEXT_DIM }}>—</span>}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {item.uid && <button onClick={() => setSlideUnit({ ...item, batch: item.uid.split('-')[0].replace(/(\d+)$/, '-$1') })} style={{ background: "none", color: TEXT_DIM, border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer" }}>View Unit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SlideOut open={!!slideUnit} onClose={() => setSlideUnit(null)} title={slideUnit ? `Unit ${slideUnit.uid}` : ""}>
        {slideUnit && (
          <div style={{ display: "grid", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { label: "SKU", value: slideUnit.sku || "—" },
                { label: "Unit ID", value: slideUnit.uid },
                { label: "Landed Cost", value: slideUnit.landedCost ? `£${slideUnit.landedCost.toFixed(2)}` : "—" },
                { label: "Carrier", value: slideUnit.carrier || "—" },
                { label: "Tracking", value: slideUnit.tracking || "—" },
                { label: "Payout", value: slideUnit.payoutStatus || "—" },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: 10, color: TEXT_DIM, textTransform: "uppercase", letterSpacing: "0.05em" }}>{f.label}</div>
                  <Mono color={f.label === "Landed Cost" ? TEAL : f.label === "SKU" ? AMBER : TEXT_MED} size={13}>{f.value}</Mono>
                </div>
              ))}
            </div>
            <div>
              <SectionHead>Unit Lifecycle</SectionHead>
              <UnitLifecycle status={slideUnit.unitStatus} />
            </div>
          </div>
        )}
      </SlideOut>
    </div>
  );
};

// ─── Payouts ─────────────────────────────────────────────────────────────────

const PayoutView = () => (
  <div>
    <h1 style={{ fontSize: 22, fontWeight: 700, color: TEXT, margin: "0 0 4px" }}>Payouts</h1>
    <p style={{ color: TEXT_DIM, fontSize: 13, margin: "0 0 20px" }}>Channel payouts, fee breakdowns, QBO sync.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
      {[
        { channel: "eBay", pending: "£187.42", next: "25 Mar", orders: 6, units: 8 },
        { channel: "Stripe", pending: "£48.99", next: "24 Mar", orders: 2, units: 2 },
        { channel: "Blue Bell Owed", pending: "£14.20", next: "Manual", orders: 8, units: 10 },
      ].map(p => (
        <Card key={p.channel}>
          <div style={{ fontSize: 12, color: TEXT_DIM, marginBottom: 8 }}>{p.channel}</div>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, color: TEAL, fontWeight: 700 }}>{p.pending}</div>
          <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 8 }}>{p.orders} orders · {p.units} units · Next: {p.next}</div>
        </Card>
      ))}
    </div>
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${BORDER}` }}><SectionHead>Recent Payouts</SectionHead></div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["Date", "Channel", "Gross", "Fees", "Net", "Orders", "Units", "QBO"].map(h => (
              <th key={h} style={{ padding: "10px 12px", textAlign: "left", color: TEXT_DIM, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            { date: "18 Mar", ch: "eBay", gross: "£312.45", fees: "£43.74", net: "£268.71", orders: 8, units: 11, qbo: "Synced" },
            { date: "17 Mar", ch: "Stripe", gross: "£89.98", fees: "£2.61", net: "£87.37", orders: 3, units: 3, qbo: "Synced" },
            { date: "11 Mar", ch: "eBay", gross: "£547.20", fees: "£76.61", net: "£470.59", orders: 14, units: 19, qbo: "Synced" },
          ].map((p, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
              <td style={{ padding: "10px 12px", color: TEXT_MED }}>{p.date}</td>
              <td style={{ padding: "10px 12px", color: TEXT }}>{p.ch}</td>
              <td style={{ padding: "10px 12px" }}><Mono>{p.gross}</Mono></td>
              <td style={{ padding: "10px 12px" }}><Mono color={RED}>{p.fees}</Mono></td>
              <td style={{ padding: "10px 12px" }}><Mono color={TEAL}>{p.net}</Mono></td>
              <td style={{ padding: "10px 12px", color: TEXT_MED, textAlign: "center" }}>{p.orders}</td>
              <td style={{ padding: "10px 12px", color: TEXT_MED, textAlign: "center" }}>{p.units}</td>
              <td style={{ padding: "10px 12px" }}><Badge label={p.qbo} color={GREEN} small /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </div>
);

// ─── App Shell ───────────────────────────────────────────────────────────────

export default function KusoHub() {
  const [view, setView] = useState("purchases");
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const navigate = (v) => { setView(v); setSelectedBatch(null); setSelectedProduct(null); setSelectedOrder(null); };
  const ungradedCount = mockBatches.reduce((s, b) => s + b.ungradedCount, 0);
  const actionOrders = mockOrders.filter(o => ["needs_allocation","return_pending"].includes(o.status)).length;
  const activeKey = view === "batch_detail" ? "purchases" : view === "product_detail" ? "products" : view === "order_detail" ? "orders" : view;

  return (
    <div style={{ display: "flex", height: "100vh", background: CHARCOAL, fontFamily: "'Inter', -apple-system, sans-serif", color: TEXT }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

      <div style={{ width: 220, background: "#18181B", borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 24px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: `linear-gradient(135deg, ${AMBER}, #D97706)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: CHARCOAL }}>K</div>
            <div><div style={{ fontSize: 14, fontWeight: 700, color: TEXT, lineHeight: 1.2 }}>Kuso Hub</div><div style={{ fontSize: 10, color: TEXT_DIM, letterSpacing: "0.05em" }}>OPERATIONS</div></div>
          </div>
        </div>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ padding: "4px 16px 8px", fontSize: 10, color: TEXT_DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Pipeline</div>
          <SidebarItem icon="🛒" label="Purchases" count={ungradedCount > 0 ? ungradedCount : undefined} active={activeKey === "purchases"} onClick={() => navigate("purchases")} />
          <SidebarItem icon="📦" label="Products" active={activeKey === "products"} onClick={() => navigate("products")} />
          <SidebarItem icon="🧾" label="Orders" count={actionOrders > 0 ? actionOrders : undefined} active={activeKey === "orders"} onClick={() => navigate("orders")} />
          <SidebarItem icon="💰" label="Payouts" active={activeKey === "payouts"} onClick={() => navigate("payouts")} />
        </div>
        <div style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ padding: "4px 16px 8px", fontSize: 10, color: TEXT_DIM, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>System</div>
          <SidebarItem icon="⚡" label="QBO Sync" onClick={() => {}} />
          <SidebarItem icon="📊" label="Analytics" onClick={() => {}} />
          <SidebarItem icon="⚙" label="Settings" onClick={() => {}} />
        </div>
        <div style={{ marginTop: "auto", padding: 16, borderTop: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, color: TEXT_DIM }}>QBO: <span style={{ color: GREEN }}>● Connected</span></div>
          <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 4 }}>eBay: <span style={{ color: GREEN }}>● Connected</span></div>
          <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 4 }}>Stripe: <span style={{ color: GREEN }}>● Connected</span></div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "24px 32px" }}>
        {view === "purchases" && <BatchList onSelectBatch={(b) => { setSelectedBatch(b); setView("batch_detail"); }} />}
        {view === "batch_detail" && selectedBatch && <BatchDetail batch={selectedBatch} onBack={() => navigate("purchases")} />}
        {view === "products" && <ProductList onSelectProduct={(p) => { setSelectedProduct(p); setView("product_detail"); }} />}
        {view === "product_detail" && selectedProduct && <ProductDetail product={selectedProduct} onBack={() => navigate("products")} />}
        {view === "orders" && <OrderList onSelectOrder={(o) => { setSelectedOrder(o); setView("order_detail"); }} />}
        {view === "order_detail" && selectedOrder && <OrderDetail order={selectedOrder} onBack={() => navigate("orders")} />}
        {view === "payouts" && <PayoutView />}
      </div>
    </div>
  );
}