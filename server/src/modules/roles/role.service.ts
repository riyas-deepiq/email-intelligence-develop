import { ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors';
import type { AuditActor, AuditService } from '../audit/audit.service';
import type { UserRepository } from '../users/user.repository';
import type { User, UserRole } from '../users/user.types';
import { ADMIN_PERMISSIONS, PERMISSION_CATALOG } from './permission-catalog';
import type { RoleRepository } from './role.repository';
import type {
  AssignUserRoleInput,
  CreateRoleInput,
  CustomRole,
  RoleDefinition,
  RoleListResult,
  UpdateRoleInput,
} from './role.types';

const SYSTEM_ROLES: Array<
  Pick<RoleDefinition, 'id' | 'name' | 'description' | 'baseRole' | 'permissions' | 'isSystem'>
> = [
  {
    id: 'system:superadmin',
    name: 'Super Admin',
    description: 'Owner-level access reserved for the primary administrator.',
    baseRole: 'superadmin',
    permissions: ADMIN_PERMISSIONS,
    isSystem: true,
  },
];

function roleCount(users: User[], role: UserRole, roleId?: string): number {
  return users.filter((u) => (roleId ? u.roleId === roleId : !u.roleId && u.role === role)).length;
}

function definitionFromCustom(role: CustomRole, users: User[]): RoleDefinition {
  return {
    ...role,
    isSystem: false,
    userCount: roleCount(users, role.baseRole, role.id),
  };
}

export class RoleService {
  constructor(
    private readonly roles: RoleRepository,
    private readonly users: UserRepository,
    private readonly audit?: AuditService,
  ) {}

  async listRoles(): Promise<RoleListResult> {
    const [customRoles, users] = await Promise.all([
      this.roles.listCustomRoles(),
      this.users.findAll(),
    ]);

    const now = new Date().toISOString();
    const systemRoles: RoleDefinition[] = SYSTEM_ROLES.map((role) => ({
      ...role,
      createdAt: now,
      updatedAt: now,
      userCount: roleCount(users, role.baseRole as UserRole),
    }));

    return {
      roles: [...systemRoles, ...customRoles.map((r) => definitionFromCustom(r, users))],
      permissions: PERMISSION_CATALOG,
    };
  }

  async createRole(input: CreateRoleInput, actor?: AuditActor): Promise<RoleDefinition> {
    await this.assertUniqueName(input.name);
    const role = await this.roles.create(input);

    if (actor) {
      await this.audit?.write({
        actor,
        eventType: 'role.created',
        entityType: 'role',
        entityId: role.id,
        newValue: { ...role },
      });
    }

    return { ...role, isSystem: false, userCount: 0 };
  }

  async updateRole(
    id: string,
    input: UpdateRoleInput,
    actor?: AuditActor,
  ): Promise<RoleDefinition> {
    const before = await this.roles.findById(id);
    if (!before) throw new NotFoundError(`Role ${id} not found`);
    if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
      await this.assertUniqueName(input.name);
    }

    const updated = await this.roles.update(id, input);
    if (!updated) throw new NotFoundError(`Role ${id} not found`);

    if (input.baseRole && input.baseRole !== before.baseRole) {
      const assignedUsers = (await this.users.findAll()).filter((u) => u.roleId === id);
      await Promise.all(
        assignedUsers.map((u) => this.users.updateUser(u.id, { role: input.baseRole, roleId: id })),
      );
    }

    if (actor) {
      await this.audit?.write({
        actor,
        eventType: 'role.updated',
        entityType: 'role',
        entityId: updated.id,
        oldValue: { ...before },
        newValue: { ...updated },
      });
    }

    const users = await this.users.findAll();
    return definitionFromCustom(updated, users);
  }

  async deleteRole(id: string, actor?: AuditActor): Promise<void> {
    const role = await this.roles.findById(id);
    if (!role) throw new NotFoundError(`Role ${id} not found`);

    const assigned = (await this.users.findAll()).filter((u) => u.roleId === id);
    if (assigned.length > 0) {
      throw new ForbiddenError('Move users to another role before deleting this role.');
    }

    await this.roles.delete(id);

    if (actor) {
      await this.audit?.write({
        actor,
        eventType: 'role.deleted',
        entityType: 'role',
        entityId: id,
        oldValue: { ...role },
      });
    }
  }

  async assignUserRole(
    userId: string,
    input: AssignUserRoleInput,
    actor?: AuditActor,
  ): Promise<User> {
    const before = await this.users.findById(userId);
    if (!before) throw new NotFoundError(`User ${userId} not found`);
    if (before.role === 'superadmin') {
      throw new ForbiddenError('The superadmin role cannot be changed.');
    }

    let after: User;
    let assignedLabel: string;

    if (input.roleId) {
      const role = await this.roles.findById(input.roleId);
      if (!role) throw new NotFoundError(`Role ${input.roleId} not found`);
      after = await this.users.updateUser(userId, { role: role.baseRole, roleId: role.id });
      assignedLabel = role.name;
    } else {
      const systemRole = input.systemRole!;
      after = await this.users.updateUser(userId, { role: systemRole, roleId: null });
      assignedLabel = systemRole;
    }

    if (actor) {
      await this.audit?.userEvent(
        'user.role_changed',
        actor,
        userId,
        {
          email: before.email,
          displayName: before.displayName,
          role: before.role,
          roleId: before.roleId,
          roleName: before.roleName,
        },
        {
          email: after.email,
          displayName: after.displayName,
          role: after.role,
          roleId: after.roleId,
          roleName: after.roleName ?? assignedLabel,
        },
      );
    }

    return after;
  }

  private async assertUniqueName(name: string): Promise<void> {
    const normalized = name.trim().toLowerCase();
    const duplicate = (await this.roles.listCustomRoles()).find(
      (r) => r.name.toLowerCase() === normalized,
    );
    if (duplicate || SYSTEM_ROLES.some((r) => r.name.toLowerCase() === normalized)) {
      throw new ConflictError(`A role named "${name}" already exists`);
    }
  }
}
