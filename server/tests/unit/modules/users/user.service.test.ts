import { describe, it, expect, vi } from 'vitest';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../src/lib/errors';
import { UserService } from '../../../../src/modules/users/user.service';
import type { UserRepository } from '../../../../src/modules/users/user.repository';
import type { MailboxRepository } from '../../../../src/modules/mailboxes/mailbox.repository';
import type { User } from '../../../../src/modules/users/user.types';
import { parseCreateUserDto, parseInviteUserDto } from '../../../../src/modules/users/user.schema';

// Helpers

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'test@example.com',
    displayName: 'Test User',
    role: 'employee',
    roleId: null,
    roleName: null,
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<UserRepository> = {}): UserRepository {
  return {
    findAll: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    findByEmail: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(makeUser()),
    updateUser: vi.fn().mockResolvedValue(makeUser()),
    deleteById: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as UserRepository;
}

function makeMailboxRepo(overrides: Partial<MailboxRepository> = {}): MailboxRepository {
  return {
    count: vi.fn().mockResolvedValue(1),
    findById: vi.fn().mockResolvedValue(null),
    findByAddress: vi.fn().mockResolvedValue(null),
    linkOwner: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as MailboxRepository;
}

// Tests

describe('UserService', () => {
  describe('listUsers', () => {
    it('returns all users from the repository, marked offline when there is no session store', async () => {
      const users = [makeUser(), makeUser({ id: 'user-2', email: 'b@b.com' })];
      const svc = new UserService(makeRepo({ findAll: vi.fn().mockResolvedValue(users) }));
      await expect(svc.listUsers()).resolves.toEqual(users.map((u) => ({ ...u, isOnline: false })));
    });

    it('marks a user online when they hold a live session', async () => {
      const users = [makeUser(), makeUser({ id: 'user-2', email: 'b@b.com' })];
      const sessions = {
        set: vi.fn(),
        get: vi.fn(),
        del: vi.fn(),
        listByUser: vi.fn(async (userId: string) =>
          userId === 'user-2' ? [{ sessionId: 's1', expiresAt: new Date() }] : [],
        ),
      };
      const svc = new UserService(
        makeRepo({ findAll: vi.fn().mockResolvedValue(users) }),
        undefined,
        undefined,
        sessions,
      );
      await expect(svc.listUsers()).resolves.toEqual([
        { ...users[0], isOnline: false },
        { ...users[1], isOnline: true },
      ]);
    });
  });

  describe('getUser', () => {
    it('returns the user when found', async () => {
      const user = makeUser();
      const svc = new UserService(makeRepo({ findById: vi.fn().mockResolvedValue(user) }));
      await expect(svc.getUser('user-1')).resolves.toEqual(user);
    });

    it('throws NotFoundError when user does not exist', async () => {
      const svc = new UserService(makeRepo());
      await expect(svc.getUser('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('createUser', () => {
    it('creates a new user successfully', async () => {
      const user = makeUser();
      const repo = makeRepo({ create: vi.fn().mockResolvedValue(user) });
      const svc = new UserService(repo, makeMailboxRepo());
      await expect(
        svc.createUser({ email: 'test@example.com', displayName: 'Test', role: 'employee' }),
      ).resolves.toEqual(user);
    });

    it('throws ConflictError if email already exists', async () => {
      const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(makeUser()) });
      const svc = new UserService(repo);
      await expect(
        svc.createUser({ email: 'test@example.com', displayName: 'Test', role: 'employee' }),
      ).rejects.toThrow(ConflictError);
    });

    it('throws ForbiddenError when creating employee with no mailboxes configured', async () => {
      const mailboxRepo = makeMailboxRepo({ count: vi.fn().mockResolvedValue(0) });
      const svc = new UserService(makeRepo(), mailboxRepo);
      await expect(
        svc.createUser({ email: 'new@example.com', displayName: 'New', role: 'employee' }),
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows admin creation even with no mailboxes', async () => {
      const user = makeUser({ role: 'admin' });
      const mailboxRepo = makeMailboxRepo({ count: vi.fn().mockResolvedValue(0) });
      const repo = makeRepo({ create: vi.fn().mockResolvedValue(user) });
      const svc = new UserService(repo, mailboxRepo);
      await expect(
        svc.createUser({ email: 'admin@example.com', displayName: 'Admin', role: 'admin' }),
      ).resolves.toEqual(user);
    });
  });

  describe('inviteUser', () => {
    it('invites an employee using the matching mailbox name and links the mailbox', async () => {
      const invited = makeUser({
        id: 'user-2',
        email: 'alice@example.com',
        displayName: 'Alice Fernando',
        status: 'invited',
      });
      const create = vi.fn().mockResolvedValue(invited);
      const mailboxRepo = makeMailboxRepo({
        findByAddress: vi.fn().mockResolvedValue({
          id: 'mb-1',
          address: 'alice@example.com',
          displayName: 'Alice Fernando',
          ownerUserId: null,
        }),
      });
      const svc = new UserService(makeRepo({ create }), mailboxRepo);

      await expect(svc.inviteEmployee('alice@example.com')).resolves.toEqual(invited);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({
        email: 'alice@example.com',
        displayName: 'Alice Fernando',
        role: 'employee',
        status: 'invited',
      }));
      expect(mailboxRepo.linkOwner).toHaveBeenCalledWith('mb-1', 'user-2');
    });

    it('creates user with invited status', async () => {
      const invited = makeUser({ status: 'invited' });
      const repo = makeRepo({ create: vi.fn().mockResolvedValue(invited) });
      const svc = new UserService(repo);
      const result = await svc.inviteUser({
        email: 'new@example.com',
        displayName: 'New',
        role: 'employee',
      });
      expect(result.status).toBe('invited');
    });

    it('throws ConflictError if email already registered', async () => {
      const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(makeUser()) });
      const svc = new UserService(repo);
      await expect(
        svc.inviteUser({ email: 'test@example.com', displayName: 'Test', role: 'employee' }),
      ).rejects.toThrow(ConflictError);
    });

    it('re-invites a deactivated user instead of throwing ConflictError', async () => {
      const deactivated = makeUser({ status: 'inactive' });
      const updateUser = vi.fn().mockResolvedValue(makeUser({ status: 'invited' }));
      const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(deactivated), updateUser });
      const svc = new UserService(repo);

      const result = await svc.inviteUser({
        email: 'test@example.com',
        displayName: 'Test',
        role: 'employee',
      });

      expect(result.status).toBe('invited');
      expect(updateUser).toHaveBeenCalledWith(
        deactivated.id,
        expect.objectContaining({ status: 'invited' }),
      );
    });
  });

  describe('invite validation', () => {
    it('accepts only a normalized email and blocks role escalation', () => {
      expect(parseInviteUserDto({ email: 'New.User@Example.com' })).toEqual({
        email: 'new.user@example.com',
      });
      expect(() => parseInviteUserDto({
        email: 'new@example.com',
        role: 'superadmin',
      })).toThrow('only email is accepted');
      expect(() => parseInviteUserDto({
        email: 'new@example.com',
        displayName: 'Injected Name',
      })).toThrow('only email is accepted');
      expect(() => parseCreateUserDto({
        email: 'new@example.com',
        displayName: 'New User',
        role: 'superadmin',
      })).toThrow('role must be one of: employee, admin');
    });
  });

  describe('cancelInvite', () => {
    it('deletes the invited user', async () => {
      const user = makeUser({ status: 'invited' });
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(user),
        deleteById: vi.fn().mockResolvedValue(undefined),
      });
      const svc = new UserService(repo);
      await svc.cancelInvite('user-1');
      expect(repo.deleteById).toHaveBeenCalledWith('user-1');
    });

    it('throws NotFoundError when user does not exist', async () => {
      const svc = new UserService(makeRepo());
      await expect(svc.cancelInvite('missing')).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when user is not in invited status', async () => {
      const user = makeUser({ status: 'active' });
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(user) });
      const svc = new UserService(repo);
      await expect(svc.cancelInvite('user-1')).rejects.toThrow(ForbiddenError);
    });
  });

  describe('deactivateUser', () => {
    it('sets status to inactive', async () => {
      const user = makeUser({ status: 'active' });
      const updated = makeUser({ status: 'inactive' });
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(user),
        updateUser: vi.fn().mockResolvedValue(updated),
      });
      const svc = new UserService(repo);
      await expect(svc.deactivateUser('user-1')).resolves.toEqual(updated);
    });

    it('is idempotent when already inactive', async () => {
      const user = makeUser({ status: 'inactive' });
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(user) });
      const svc = new UserService(repo);
      const result = await svc.deactivateUser('user-1');
      expect(result.status).toBe('inactive');
      expect(repo.updateUser).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when user does not exist', async () => {
      const svc = new UserService(makeRepo());
      await expect(svc.deactivateUser('missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('reactivateUser', () => {
    it('sets status to active', async () => {
      const user = makeUser({ status: 'inactive' });
      const updated = makeUser({ status: 'active' });
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(user),
        updateUser: vi.fn().mockResolvedValue(updated),
      });
      const svc = new UserService(repo);
      await expect(svc.reactivateUser('user-1')).resolves.toEqual(updated);
    });

    it('is idempotent when already active', async () => {
      const user = makeUser({ status: 'active' });
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(user) });
      const svc = new UserService(repo);
      const result = await svc.reactivateUser('user-1');
      expect(result.status).toBe('active');
      expect(repo.updateUser).not.toHaveBeenCalled();
    });
  });

  describe('createUserFromMailbox', () => {
    const mailbox = {
      id: 'mb-1',
      address: 'alice@example.com',
      displayName: 'Alice',
      ownerUserId: null as string | null,
    };

    it('creates a new user from mailbox and links it', async () => {
      const created = makeUser({ email: 'alice@example.com' });
      const mbRepo = makeMailboxRepo({ findById: vi.fn().mockResolvedValue(mailbox) });
      const repo = makeRepo({ create: vi.fn().mockResolvedValue(created) });
      const svc = new UserService(repo, mbRepo);
      const result = await svc.createUserFromMailbox('mb-1');
      expect(result.email).toBe('alice@example.com');
      expect(mbRepo.linkOwner).toHaveBeenCalledWith('mb-1', created.id);
    });

    it('returns existing user and links mailbox if not already linked', async () => {
      const existing = makeUser({ email: 'alice@example.com' });
      const mbRepo = makeMailboxRepo({ findById: vi.fn().mockResolvedValue(mailbox) });
      const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(existing) });
      const svc = new UserService(repo, mbRepo);
      const result = await svc.createUserFromMailbox('mb-1');
      expect(result).toEqual(existing);
      expect(mbRepo.linkOwner).toHaveBeenCalledWith('mb-1', existing.id);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('does not re-link mailbox if already linked', async () => {
      const existing = makeUser({ email: 'alice@example.com' });
      const linkedMailbox = { ...mailbox, ownerUserId: existing.id };
      const mbRepo = makeMailboxRepo({ findById: vi.fn().mockResolvedValue(linkedMailbox) });
      const repo = makeRepo({ findByEmail: vi.fn().mockResolvedValue(existing) });
      const svc = new UserService(repo, mbRepo);
      await svc.createUserFromMailbox('mb-1');
      expect(mbRepo.linkOwner).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when mailbox does not exist', async () => {
      const mbRepo = makeMailboxRepo({ findById: vi.fn().mockResolvedValue(null) });
      const svc = new UserService(makeRepo(), mbRepo);
      await expect(svc.createUserFromMailbox('missing')).rejects.toThrow(NotFoundError);
    });

    it('throws when mailboxRepo is not provided', async () => {
      const svc = new UserService(makeRepo());
      await expect(svc.createUserFromMailbox('mb-1')).rejects.toThrow(
        'Mailbox repository not available',
      );
    });
  });

  describe('updateUser', () => {
    it('updates user fields', async () => {
      const before = makeUser();
      const after = makeUser({ displayName: 'Updated' });
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(before),
        updateUser: vi.fn().mockResolvedValue(after),
      });
      const svc = new UserService(repo);
      await expect(svc.updateUser('user-1', { displayName: 'Updated' })).resolves.toEqual(after);
    });

    it('throws ConflictError if new email is taken by another user', async () => {
      const before = makeUser();
      const other = makeUser({ id: 'user-2', email: 'taken@example.com' });
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(before),
        findByEmail: vi.fn().mockResolvedValue(other),
      });
      const svc = new UserService(repo);
      await expect(svc.updateUser('user-1', { email: 'taken@example.com' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('throws NotFoundError when user does not exist', async () => {
      const svc = new UserService(makeRepo());
      await expect(svc.updateUser('missing', { displayName: 'X' })).rejects.toThrow(NotFoundError);
    });
  });
});
