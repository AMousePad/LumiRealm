import { setupUuid } from '../../src/util/uuid.js';

const randomId = (): string => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));

export const testUuid = { v4: randomId, v7: randomId };

setupUuid({ uuid: testUuid });
