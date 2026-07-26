import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';
/** Restricts a route to users with one of the given platform roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
