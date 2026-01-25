/**
 * Drizzle migrations for Durable Object SQLite
 * 
 * This file exports the migration journal for use with the Drizzle migrator.
 * Import SQL migration files as text and provide them with the journal.
 */

import journal from './meta/_journal.json';
import m0000 from './0000_wise_elektra.sql';
import m0001 from './0001_checkpoint_tables.sql';
import m0002 from './0002_add_checkpoint_visibility.sql';
import m0003 from './0003_eminent_cardiac.sql';

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
  },
};
