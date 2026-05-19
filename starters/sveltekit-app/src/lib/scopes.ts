import { bitmaskFromScopes } from '@civitai/app-sdk/scopes';

export const REQUESTED_SCOPES = bitmaskFromScopes([
  'UserRead',
  'BuzzRead',
  'AIServicesRead',
  'AIServicesWrite',
]);
