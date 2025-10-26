# EventRecorder Extension

`EventRecorder` listens for Semantic MediaWiki (SMW) property updates and publishes
structured events to MediaWiki's EventBus. It emits an **upsert** event whenever
SMW updates a page's semantic data (covering both insert and update operations),
and a **delete** event when semantic data is removed.

## Configuration

A few knobs are exposed through `$wg` configuration variables (defaults are
defined in `extension.json`):

| Variable | Default | Description |
| --- | --- | --- |
| `$wgEventRecorderEventService` | `eventbus` | Name of the EventBus transport to use. |
| `$wgEventRecorderStream` | `mediawiki.smw.property_change` | Stream name attached to the event meta block. |
| `$wgEventRecorderTopic` | `mediawiki.smw.property_change` | Kafka topic emitted in the meta block. |
| `$wgEventRecorderSchema` | `/mediawiki/smw/property-change/1` | Schema URI advertised in the event meta block. |

The extension expects both Semantic MediaWiki and EventBus to be installed.
When SMW is not available the hook registration is skipped; when EventBus is
unavailable, events are dropped and a debug log is emitted.

## Event shape

Each event is sent with the following structure:

```json
{
  "meta": {
    "id": "uuid",
    "dt": "2024-01-01T00:00:00Z",
    "stream": "mediawiki.smw.property_change",
    "topic": "mediawiki.smw.property_change",
    "schema_uri": "/mediawiki/smw/property-change/1",
    "domain": "example.org"
  },
  "payload": {
    "action": "upsert",
    "subject": {
      "title": "Page title",
      "namespace": 0,
      "page_id": 123,
      "prefixed_db_key": "Page_title",
      "latest_rev_id": 456
    },
    "properties": [
      {
        "id": "Has foo",
        "label": "Has foo",
        "type": "_txt",
        "values": ["bar"]
      }
    ]
  }
}
```

The `action` field is set to `upsert` for SMW updates (including first-time
inserts) and `delete` for removals. The `properties` array reflects the data
reported by SMW for the event; delete events usually omit it as SMW does not
include the values being removed.

## Logging

The extension writes to the `eventrecorder` logging channel. Enable it in
`LocalSettings.php` for debugging:

```php
$wgDebugLogGroups[ 'eventrecorder' ] = '/var/log/mediawiki/eventrecorder.log';
```
