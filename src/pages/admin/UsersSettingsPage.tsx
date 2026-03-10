import { useEffect, useState, useMemo } from "react";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useTablePreferences } from "@/hooks/useTablePreferences";
import { SortableTableHead } from "@/components/admin/SortableTableHead";
import { ColumnSelector } from "@/components/admin/ColumnSelector";
import { sortRows } from "@/lib/table-utils";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
}

const ALL_ROLES = ["admin", "staff", "member"] as const;

const ALL_COLUMNS: { key: string; label: string; align?: "left" | "center" | "right" }[] = [
  { key: "user", label: "User" },
  { key: "email", label: "Email" },
  { key: "admin", label: "Admin", align: "center" as const },
  { key: "staff", label: "Staff", align: "center" as const },
  { key: "member", label: "Member", align: "center" as const },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map((c) => c.key);

function getSortValue(u: UserRow, key: string): unknown {
  switch (key) {
    case "user": return u.display_name ?? "";
    case "email": return u.email;
    case "admin": return u.roles.includes("admin");
    case "staff": return u.roles.includes("staff");
    case "member": return u.roles.includes("member");
    default: return null;
  }
}

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const tp = useTablePreferences("admin-users", DEFAULT_VISIBLE, { key: "user", dir: "asc" });

  const fetchUsers = async () => {
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) {
      toast.error("Failed to load users: " + error.message);
      setLoading(false);
      return;
    }
    setUsers((data as UserRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q),
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

  const initials = (name: string | null, email: string) => {
    if (name) return name.slice(0, 2).toUpperCase();
    return email.slice(0, 2).toUpperCase();
  };

  const visibleCols = tp.prefs.visibleColumns
    .map((k) => ALL_COLUMNS.find((c) => c.key === k))
    .filter(Boolean) as typeof ALL_COLUMNS;

  function renderCell(user: UserRow, key: string): React.ReactNode {
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

  return (
    <BackOfficeLayout title="User Management">
      <div className="animate-fade-in space-y-6">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Users & Roles</h2>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Manage user roles across the platform. Changes take effect immediately.
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
                {visibleCols.map((col) => (
                  <SortableTableHead
                    key={col.key}
                    columnKey={col.key}
                    label={col.label}
                    sortKey={tp.prefs.sort.key}
                    sortDir={tp.prefs.sort.dir}
                    onToggleSort={tp.toggleSort}
                    align={col.align}
                    className={col.key === "user" ? "w-[300px]" : col.align === "center" ? "w-[120px]" : ""}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.length} className="text-center text-muted-foreground py-12">Loading users…</TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleCols.length} className="text-center text-muted-foreground py-12">No users found.</TableCell>
                </TableRow>
              ) : (
                sorted.map((user) => (
                  <TableRow key={user.user_id}>
                    {visibleCols.map((col) => (
                      <TableCell key={col.key} className={col.align === "center" ? "text-center" : ""}>
                        {renderCell(user, col.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </BackOfficeLayout>
  );
}
