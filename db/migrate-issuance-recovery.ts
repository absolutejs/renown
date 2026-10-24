import { sql } from './index.ts';
import { issuanceRecoveryStatements } from './issuance-recovery.ts';
await sql.transaction(issuanceRecoveryStatements.map((statement) => sql.query(statement)));
console.log('Durable collectible issuance recovery is ready.');
