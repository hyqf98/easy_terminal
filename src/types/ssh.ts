export interface SSHProfile {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  user: string;
  jumpProfileId: string;
  authType: 'password' | 'key';
  password: string;
  privateKeyPath: string;
}
