<?php

namespace MediaWiki\Extension\EventRecorder;

use MediaWiki\Extension\EventBus\EventBusFactory;
use MediaWiki\MediaWikiServices;
use MediaWiki\Title\Title;
use Psr\Log\LoggerInterface;
use SMW\DIProperty;
use SMW\DIWikiPage;
use SMW\SemanticData;
use MediaWiki\Logger\LoggerFactory;
use SMW\SQLStore\SQLStore;
use SMW\Store;

class EventRecorderHooks {
    /**
     * Register Semantic MediaWiki specific hooks after extension setup.
     */
    public static function onSetupAfterCache(): void {
        wfDebugLog('evrec', 'setup');
        if ( !class_exists( SemanticData::class ) ) {
            self::getLogger()->debug( 'SMW not installed; EventRecorder inactive' );
            return;
        }

        $hookContainer = MediaWikiServices::getInstance()->getHookContainer();

        $hookContainer->register( 'SMW::Store::AfterDataUpdateComplete', [ self::class, 'onSemanticDataUpsert' ] );
        // FIXME: Is there any chance that we use a non-SQL store?
        $hookContainer->register( 'SMW::SQLStore::AfterDeleteSubjectComplete', [ self::class, 'onSemanticDataDelete' ] );
    }

    /**
     * Handle property insert/update events.
     *
     * @param Store $store
     * @param SemanticData $semanticData
     * @return bool
     */
    public static function onSemanticDataUpsert( Store $store, SemanticData $semanticData ) {
        wfDebugLog( 'evrec', 'upsert' );

        $isDelete = $semanticData->getOption( SemanticData::PROC_DELETE, false );
        $action = $isDelete ? 'delete' : 'upsert';

        self::emitEvent( $action, $semanticData );
        return true;
    }

    /**
     * Handle property deletion events.
     *
     * @param SQLStore $store
     * @param Title $title
     * @return bool
     */
    public static function onSemanticDataDelete( SQLStore $store, Title $title ) {
        $subject = DIWikiPage::newFromTitle( $title );
        self::emitEvent( 'delete', null, $subject );
        return true;
    }

    private static function emitEvent( string $action, ?SemanticData $semanticData = null, ?DIWikiPage $subject = null ): void {
        $services = MediaWikiServices::getInstance();
        $config = $services->getMainConfig();

        if ( !$services->hasService( 'EventBus.EventBusFactory' ) ) {
            self::getLogger()->debug( 'EventBusFactory service unavailable; skip event' );
            return;
        }

        /** @var EventBusFactory $factory */
        $factory = $services->getService( 'EventBus.EventBusFactory' );
        $serviceName = $config->get( 'EventRecorderEventService' );

        try {
            self::getLogger()->debug( 'get service ' . $serviceName );
            $bus = $factory->getInstance( $serviceName );
        } catch ( \Throwable $e ) {
            self::getLogger()->warning( 'EventBus unavailable', [ 'exception' => $e ] );
            return;
        }

        if ( !$subject && $semanticData ) {
            $subject = $semanticData->getSubject();
        }

        if ( !$subject ) {
            self::getLogger()->debug( 'No subject resolved for SMW event; skipping' );
            return;
        }

        $title = self::titleFromSubject( $subject );

        $payload = [
            'action' => $action,
            'subject' => [
                'title' => $title ? $title->getPrefixedText() : $subject->getSerialization(),
                'namespace' => $title ? $title->getNamespace() : $subject->getNamespace(),
                'page_id' => $title ? $title->getArticleID() : null,
                'prefixed_db_key' => $subject->getDBKey(),
            ],
            'properties' => $semanticData ? self::serializeSemanticData( $semanticData ) : [],
        ];

        if ( $title ) {
            $payload['subject']['latest_rev_id'] = $title->getLatestRevID();
        }

        $meta = [
            'id' => $services->getGlobalIdGenerator()->newUUIDv4(),
            'dt' => wfTimestamp( TS_ISO_8601 ),
            'stream' => $config->get( 'EventRecorderStream' ),
            'topic' => $config->get( 'EventRecorderTopic' ),
            'schema_uri' => $config->get( 'EventRecorderSchema' ),
            'domain' => $config->get( 'ServerName' ),
        ];

        $event = [
            'meta' => $meta,
            'payload' => $payload,
        ];

        try {
            self::getLogger()->debug( 'send event ' );
            $result = $bus->send( $event );

            if ( $result !== true ) {
                $context = [ 'payload' => $payload ];

                if ( is_array( $result ) ) {
                    $context['errors'] = $result;
                } elseif ( is_string( $result ) ) {
                    $context['error'] = $result;
                } else {
                    $context['result'] = $result;
                }

                self::getLogger()->error( "EventBus send returned unsuccessful response $result" );
            }
        } catch ( \Throwable $e ) {
            self::getLogger()->error( 'Failed to send EventBus event', [ 'exception' => $e, 'payload' => $payload ] );
        }
    }

    private static function serializeSemanticData( SemanticData $data ): array {
        $properties = [];
        foreach ( $data->getProperties() as $property ) {
            if ( !( $property instanceof DIProperty ) ) {
                continue;
            }
            $values = [];
            foreach ( $data->getPropertyValues( $property ) as $value ) {
                if ( method_exists( $value, 'getSerialization' ) ) {
                    $values[] = $value->getSerialization();
                } elseif ( method_exists( $value, '__toString' ) ) {
                    $values[] = (string)$value;
                } else {
                    $values[] = $value;
                }
            }

            $entry = [
                'id' => $property->getKey(),
                'values' => $values,
            ];

            if ( method_exists( $property, 'getLabel' ) ) {
                $entry['label'] = $property->getLabel();
            }
            if ( method_exists( $property, 'getDiType' ) ) {
                $entry['type'] = $property->getDiType();
            } elseif ( method_exists( $property, 'getDataType' ) ) {
                $entry['type'] = $property->getDataType();
            }

            $properties[] = $entry;
        }
        return $properties;
    }

    private static function titleFromSubject( DIWikiPage $subject ): ?Title {
        if ( method_exists( $subject, 'getTitle' ) ) {
            return $subject->getTitle();
        }
        return null;
    }

    private static function getLogger(): LoggerInterface {
        return LoggerFactory::getInstance( 'eventrecorder' );
    }
}
