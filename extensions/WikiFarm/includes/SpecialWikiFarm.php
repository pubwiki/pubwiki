<?php

namespace MediaWiki\Extension\WikiFarm;

use MediaWiki\SpecialPage\SpecialPage;
use MediaWiki\Html\Html;
use MediaWiki\MediaWikiServices;

class SpecialWikiFarm extends SpecialPage {
    public function __construct() {
        parent::__construct( 'WikiFarm' );
    }

    public function execute( $par ) {
        $this->setHeaders();
        $out = $this->getOutput();
        $this->addHelpLink( 'https://www.mediawiki.org/wiki/Extension:WikiFarm' );

        // Load Codex UI module
        $out->addModules( [ 'ext.wikifarm.ui' ] );

        // Pass minimal bootstrap data
        $user = $this->getUser();
        $config = MediaWikiServices::getInstance()->getMainConfig();
        // Derive base domain from current host: strip the left-most label if there are >=3 labels
        // Examples:
        //   en.dev.pub.wiki -> dev.pub.wiki
        //   sub.pub.wiki    -> pub.wiki
        //   pub.wiki        -> pub.wiki (unchanged)
        //   localhost       -> localhost (unchanged)
        $request = $this->getRequest();
        $host = $request->getHeader( 'Host' ) ?: $request->getServer( 'SERVER_NAME' );
        $baseDomain = $host;
        if ( $host && strpos( $host, ':' ) !== false ) { // strip port
            $host = preg_replace( '/:.*/', '', $host );
        }
        $parts = $host ? explode( '.', $host ) : [];
        if ( count( $parts ) >= 3 ) {
            array_shift( $parts ); // remove first label
            $baseDomain = implode( '.', $parts );
        } elseif ( $host ) {
            $baseDomain = $host; // keep as-is (2 or fewer labels)
        }

        $out->addJsConfigVars( [
            'wgWikiFarm' => [
                'isLoggedIn' => $user->isRegistered(),
                'username' => $user->isRegistered() ? $user->getName() : null,
                'userId' => $user->isRegistered() ? (int)$user->getId() : null,
                'baseDomain' => $baseDomain
            ]
        ] );

        wfDebugLog( 'wikifarm', "main page invoked");
        // Responsive container for Codex app
        $out->addHTML( Html::rawElement( 'div', [ 'id' => 'wikifarm-app' ], '' ) );
    }
}
