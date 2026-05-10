// Role-based permission helpers.

export type AppRole = "admin" | "supervisor" | "user";

export interface RoleCapabilities {
  canManageEmployees: boolean;
  canExportReports: boolean;
  canViewAnalytics: boolean;
  canViewLogs: boolean;
  canModifySettings: boolean;
  canManageUsers: boolean;
}

export function capabilitiesFor(roles: AppRole[]): RoleCapabilities {
  const has = (r: AppRole) => roles.includes(r);
  const isAdmin = has("admin");
  const isSupervisor = has("supervisor");
  return {
    canManageEmployees: isAdmin,
    canManageUsers: isAdmin,
    canModifySettings: isAdmin || isSupervisor,
    canExportReports: isAdmin || isSupervisor,
    canViewAnalytics: isAdmin || isSupervisor,
    canViewLogs: isAdmin || isSupervisor || has("user"),
  };
}

export function roleLabel(roles: AppRole[]): string {
  if (roles.includes("admin")) return "Admin";
  if (roles.includes("supervisor")) return "Supervisor";
  return "Viewer";
}
