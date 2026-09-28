import { getRequestConfig } from 'next-intl/server';
import ar from '../messages/ar.json';

// Arabic only for now. The users.locale column is in place for adding English later.
export default getRequestConfig(async () => ({
  locale: 'ar',
  messages: ar,
  timeZone: 'Asia/Riyadh',
}));
