import { useEffect, useState } from "react";
import { BackOfficeLayout } from "@/components/BackOfficeLayout";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";

interface UserRow {
  user_id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  roles: string[];
}

const ALL_ROLES = ["admin", "staff", "member"] as const;

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    fetchUsers();
  }, []);

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
    // Optimistic update
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

  return (
    <BackOfficeLayout title="User Management">
      <div className="animate-fade-in space-y-6">
        <div>
          <h2 className="font-display text-lg font-bold text-foreground">Users & Roles</h2>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            Manage user roles across the platform. Changes take effect immediately.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">User</TableHead>
                {ALL_ROLES.map((role) => (
                  <TableHead key={role} className="text-center capitalize w-[120px]">
                    {role}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                    Loading users…
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                    No users found. You may not have admin access.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={user.avatar_url ?? undefined} />
                          <AvatarFallback className="text-xs">
                            {initials(user.display_name, user.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-body text-sm font-medium text-foreground truncate">
                            {user.display_name || "—"}
                          </p>
                          <p className="font-body text-xs text-muted-foreground truncate">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    {ALL_ROLES.map((role) => {
                      const has = user.roles.includes(role);
                      return (
                        <TableCell key={role} className="text-center">
                          <Checkbox
                            checked={has}
                            onCheckedChange={() => toggleRole(user.user_id, role, has)}
                          />
                        </TableCell>
                      );
                    })}
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
