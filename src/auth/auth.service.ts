import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { NVarChar } from 'mssql';
import { DatabaseService } from '../database/database.service';
import { JwtPayload } from './auth.types';
import { LoginDto } from './dto/login.dto';

interface UserRow {
  Usr_Id: number;
  Usr_NM: string;
  TheName: string | null;
  Pass: string | null;
  Usr_Stat: boolean | null;
  isSuperVisor: boolean | null;
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async login({ username, password }: LoginDto) {
    const request = await this.db.request();
    const { recordset } = await request
      .input('username', NVarChar(50), username)
      .query<UserRow>(
        `SELECT TOP 1 Usr_Id, Usr_NM, TheName, Pass, Usr_Stat, isSuperVisor
         FROM JS_Users
         WHERE Usr_NM = @username`,
      );

    const user = recordset[0];
    // JS_Users.Pass is stored as plain text by the desktop system.
    if (!user || !safeEqual(user.Pass ?? '', password)) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.Usr_Stat === false) {
      throw new ForbiddenException('This user account is disabled');
    }

    const payload: JwtPayload = {
      sub: user.Usr_Id,
      username: user.Usr_NM,
      name: user.TheName?.trim() ?? null,
      isSupervisor: user.isSuperVisor === true,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      user: {
        id: payload.sub,
        username: payload.username,
        name: payload.name,
        isSupervisor: payload.isSupervisor,
      },
    };
  }
}
