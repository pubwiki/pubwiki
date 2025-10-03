<?php

namespace MediaWiki\Extension\WikiFarm;

use DatabaseUpdater;

class Hooks {
    /**
     * @param DatabaseUpdater $updater
     * @return bool
     */
    public static function onLoadExtensionSchemaUpdates( $updater ) {
        $dir = __DIR__ . '/../sql/tables.sql';
        $updater->addExtensionTable( 'wikifarm_wikis', $dir );
        $updater->addExtensionTable( 'wikifarm_tasks', $dir );
        $updater->addExtensionTable( 'wikifarm_wiki_group_permissions', $dir );
        return true;
    }
}
