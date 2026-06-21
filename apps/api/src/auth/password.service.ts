import { Injectable } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';

@Injectable()
export class PasswordService {
  async hashPassword(plain: string): Promise<string> {
    return hash(plain, { type: argon2id });
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    return verify(storedHash, plain);
  }
}
