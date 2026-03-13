import React, { useEffect, useState, useMemo } from "react";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

interface DetailedUserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  mobile: string | null;
  ebay_username: string | null;
  facebook_handle: string | null;
  instagram_handle: string | null;
  roles: string[];
  order_count: number;
  total_order_value: number;
}

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "user", label: "User" },
  { key: "email", label: "Email" },
  { key: "orders", label: "Orders", align: "center" as const },
  { key: "value", label: "Total Value", align: "right" as const },
  { key: "admin", label: "Admin", align: "center" as const },
  { key: "staff", label: "Staff", align: "center" as const },
  { key: "member", label: "Member", align: "center" as const },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(u: DetailedUserRow, key: string): unknown {
  switch (key) {
    case "user": return u.display_name ?? "";
    case "email": return u.email;
    case "orders": return u.order_count;
    case "value": return u.total_order_value;
    case "admin": return u.roles.includes("admin");
    case "staff": return u.roles.includes("staff");
    case "member": return u.roles.includes("member");
    default: return null;
  }
}

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<DetailedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const tp = useTablePreferences("admin-users", DEFAULT_VISIBLE, { key: "user", dir: "asc" });

  const fetchUsers = async () => {
    // Try detailed RPC first, fall back to basic
    const { data, error } = await supabase.rpc("admin_list_users_detailed");
    if (error) {
      // Fallback to basic RPC
      const { data: basicData, error: basicError } = await supabase.rpc("admin_list_users");
      if (basicError) {
        toast.error("Failed to load users: " + basicError.message);
        setLoading(false);
        return;
      }
      setUsers(
        (basicData as any[])?.map((u: any) => ({
          ...u,
          first_name: null,
          last_name: null,
          company_name: null,
          phone: null,
          mobile: null,
          ebay_username: null,
          facebook_handle: null,
          instagram_handle: null,
          order_count: 0,
          total_order_value: 0,
        })) ?? []
      );
      setLoading(false);
      return;
    }
    setUsers((data as DetailedUserRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q) ||
        (u.first_name ?? "").toLowerCase().includes(q) ||
        (u.last_name ?? "").toLowerCase().includes(q),
    );
  }, [users, search]);

  const sorted = useMemo(
    () => sortRows(filtered, tp.prefs.sort.key, tp.prefs.sort.dir, getSortValue),
    [filtered, tp.prefs.sort],
  );

  const toggleRole = async (userId: string, role: string, currentlyHas: boolean) => {
    const { error } = await supabase.rpc("admin_set_user_role", {
      target_user_id: userId,
      target_role: role as "admin" | "staff" | "member",
      assign: !currentlyHas,
    });
    if (error) {
      toast.error("Failed to update role: " + error.message);
      return;
    }
    toast.success(`Role ${!currentlyHas ? "assigned" : "removed"}`);
    setUsers((prev) =>
      prev.map((u) => {
        if (u.user_id !== userId) return u;
        const roles = currentlyHas
          ? u.roles.filter((r) => r !== role)
          : [...u.roles, role];
        return { ...u, roles };
      })
    );
  };

  const toggleExpanded = (userId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const initials = (name: string | null, email: string) => {
    if (name) return name.slice(0, 2).toUpperCase();
    return email.slice(0, 2).toUpperCase();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(amount);
  };

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  function renderCell(user: DetailedUserRow, key: string): React.ReactNode {
    switch (key) {
      case "user":
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs">{initials(user.display_name, user.email)}</AvatarFallback>
            </Avatar>
            <p className="font-body text-sm font-medium text-foreground truncate">
              {user.display_name || "—"}
            </p>
          </div>
        );
      case "email":
        return <span className="font-body text-xs text-muted-foreground">{user.email}</span>;
      case "orders":
        return <span className="font-body text-xs text-foreground">{user.order_count}</span>;
      case "value":
        return <span className="font-body text-xs font-medium text-foreground">{formatCurrency(user.total_order_value)}</span>;
      case "admin":
      case "staff":
      case "member": {
        const has = user.roles.includes(key);
        return <Checkbox checked={has} onCheckedChange={() => toggleRole(user.user_id, key, has)} />;
      }
      default:
        return null;
    }
  }

  function renderExpandedRow(user: DetailedUserRow) {
    const ebayUrl = user.ebay_username
      ? `https://www.ebay.co.uk/usr/${user.ebay_username}`
      : null;

    return (
      <TableRow className="bg-muted/30 hover:bg-muted/30">
        <TableCell colSpan={visibleCols.length} className="p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Name details */}
            <div className="space-y-1">
              <Label className="font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Name</Label>
              <p className="font-body text-xs text-foreground">
                {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
              </p>
              {user.company_name && (
                <p className="font-body text-xs text-muted-foreground">{user.company_name}</p>
              )}
            </div>

            {/* Contact */}
            <div className="space-y-1">
              <Label className="font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Contact</Label>
              <p className="font-body text-xs text-foreground">
                Phone: {user.phone || "—"}
              </p>
              <p className="font-body text-xs text-foreground">
                Mobile: {user.mobile || "—"}
              </p>
            </div>

            {/* Linked Accounts */}
            <div className="space-y-1">
              <Label className="font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Linked Accounts</Label>
              {user.ebay_username ? (
                <div className="flex items-center gap-1">
                  <span className="font-body text-xs text-foreground">eBay: {user.ebay_username}</span>
                  {ebayUrl && (
                    <a href={ebayUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3 w-3 text-primary" />
                    </a>
                  )}
                </div>
              ) : (
                <p className="font-body text-xs text-muted-foreground">eBay: —</p>
              )}
              <p className="font-body text-xs text-foreground">
                Facebook: {user.facebook_handle || "—"}
              </p>
              <p className="font-body text-xs text-foreground">
                Instagram: {user.instagram_handle || "—"}
              </p>
            </div>

            {/* Order Summary */}
            <div className="space-y-1">
              <Label className="font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Order Summary</Label>
              <p className="font-body text-xs text-foreground">
                {user.order_count} order{user.order_count !== 1 ? "s" : ""} totalling {formatCurrency(user.total_order_value)}
              </p>
            </div>

            {/* Roles */}
            <div className="space-y-1">
              <Label className="font-display text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Roles</Label>
              <div className="flex gap-1">
                {user.roles.length > 0 ? (
                  user.roles.map((role) => (
                    <Badge key={role} variant="secondary" className="font-display text-[10px]">
                      {role}
                    </Badge>
                  ))
                ) : (
                  <span className="font-body text-xs text-muted-foreground">No roles</span>
                )}
              </div>
            </div>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <BackOfficeLayout title="User Management">
      <div className="animate-fade-in space-y-6">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Users & Roles</h2>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Manage user roles across the platform. Click a row to view full details.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            placeholder="Search users…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="sm:max-w-xs"
          />
          <div className="sm:ml-auto">
            <ColumnSelector
              allColumns={ALL_COLUMNS}
              visibleColumns={tp.prefs.visibleColumns}
              onToggleColumn={tp.toggleColumn}
              onMoveColumn={tp.moveColumn}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  columnKey=""
                  label=""
                  sortKey=""
                  sortDir="asc"
                  onToggleSort={() => {}}
                  className="w-[40px]"
                />
                {visibleCols.map((col) => (
                  <SortableTableHead
                    key={col.key}
                    columnKey={col.key}
                    label={col.label}
                    sortKey={tp.prefs.sort.key}
                    sortDir={tp.prefs.sort.dir}
                    onToggleSort={tp.toggleSort}
                    align={col.align}
                    className={col.key === "user" ? "w-[250px]" : col.align === "center" ? "w-[100px]" : col.align === "right" ? "w-[120px]" : ""}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.length + 1} className="text-center text-muted-foreground py-12">Loading users…</TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.length + 1} className="text-center text-muted-foreground py-12">No users found.</TableCell>
                </TableRow>
              ) : (
                sorted.map((user) => {
                  const isExpanded = expandedIds.has(user.user_id);
                  return (
                    <React.Fragment key={user.user_id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpanded(user.user_id)}>
                        <TableCell className="w-[40px]">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </TableCell>
                        {visibleCols.map((col) => (
                          <TableCell key={col.key} className={col.align === "center" ? "text-center" : col.align === "right" ? "text-right" : ""}>
                            {renderCell(user, col.key)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {isExpanded && renderExpandedRow(user)}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </BackOfficeLayout>
  );
}
