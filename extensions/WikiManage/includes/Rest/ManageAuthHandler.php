<?php
namespace MediaWiki\Extension\WikiManage\Rest;

use MediaWiki\Rest\SimpleHandler;
use MediaWiki\Rest\HttpException;
use GuzzleHttp\Psr7\Utils;
use MediaWiki\MediaWikiServices;

/**
 * Auth endpoint for management operations previously in WikiFarm.
 * Path: /wikimanage/v1/auth/check (invoked by forward auth proxy) OR internal use.
 * This handles only manage-related API paths (/manage/v1/...).
 */
class ManageAuthHandler extends SimpleHandler {
    public function run() {
        $req = $this->getRequest();
        $auth = $this->getAuthority();
        $user = $auth->getUser();

        $fwdUri = $req->getHeaderLine( 'X-Forwarded-Uri' );
        $fwdMethod = strtoupper( $req->getHeaderLine( 'X-Forwarded-Method' ) ?: 'GET' );
        if ( $fwdUri ) {
            $qPos = strpos( $fwdUri, '?' );
            if ( $qPos !== false ) {
                $fwdUri = substr( $fwdUri, 0, $qPos );
            }
        }

        if ( !$fwdUri ) {
            throw new HttpException( 'Bad Request', 400 );
        }

        $resp = $this->getResponseFactory()->create();
        $resp->setStatus( 200 );
        $resp->setHeader( 'Content-Type', 'application/json' );
        $resp->setHeader( 'X-Auth-User', $user->getName() );
        $resp->setHeader( 'X-Auth-User-Id', (string)$user->getId() );
        
        $resp->setBody( Utils::streamFor( json_encode( [ 'ok' => true ] ) ) );

        if ( !preg_match('#^/manage/v1(/.*)?$#', $fwdUri ) ) {
            // allow non-manage requests
            return $resp;
        }

        $decision = $this->checkManageAuth( $fwdUri, $fwdMethod, (int)$user->getId() );
        if ( !$decision ) {
            throw new HttpException( 'Not Found', 404 );
        }
        [ $needLogin, $neededRight ] = $decision;

        if ( $needLogin && ( !$user || !$user->isRegistered() ) ) {
            throw new HttpException( 'Unauthorized', 401 );
        }
        if ( $neededRight && !$auth->isAllowed( $neededRight ) ) {
            throw new HttpException( 'Forbidden', 403 );
        }

        if ( $neededRight ) { $resp->setHeader( 'X-Auth-Granted-Right', $neededRight ); }
        return $resp;
    }

    private function checkManageAuth( string $fullUri, string $method, int $currentUserId ) {
        $needLogin = true; // all manage endpoints require login
        $neededRight = 'manage-wiki-perms';
        return [ $needLogin, $neededRight ];
    }
}
