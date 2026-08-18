/**
 * Anzeige eines Status.
 *
 * Farbe, Zeichen und Text zusammen — keiner der drei traegt die Aussage allein
 * (1.4.1). Das Zeichen ist fuer Screenreader verborgen, weil der Text daneben
 * dasselbe sagt.
 */

import type { Status } from '../typen';
import { STATUS_TEXT, STATUS_ZEICHEN } from '../typen';

export function Statuszeichen({ status }: { status: Status }): React.ReactElement {
  return (
    <span className={`status status--${status}`}>
      <span className="status__zeichen" aria-hidden="true">
        {STATUS_ZEICHEN[status]}
      </span>
      {STATUS_TEXT[status]}
    </span>
  );
}
