<?php

namespace MediaWiki\Extension\WikiFarm\Rest;

use MediaWiki\Rest\SimpleHandler;
use MediaWiki\Rest\HttpException;
use GuzzleHttp\Psr7\Utils;

/**
 * ForwardAuth endpoint for Traefik.
 * Returns 200 if user is authenticated (and optionally has required rights), else 401/403.
 * Can be extended to inject headers (username, user id, groups) back to Traefik.
 */
class AuthCheckHandler extends SimpleHandler {
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
        wfDebugLog('wikifarm', "auth request $fwdMethod $fwdUri");

        if ( !$fwdUri ) {
            throw new HttpException( 'Bad Request', 400 );
        }

        // Only handle provisioning endpoints here. Management moved to WikiManage extension.
        $decision = null;
        if ( preg_match('#^/provisioner/v1(/.*)?$#', $fwdUri ) ) {
            $path = substr( $fwdUri, strlen('/provisioner/v1') );
            if ( $path === '' ) { $path = '/'; }
            $decision = $this->checkProvisionAuth( $path, $fwdMethod, (int)$user->getId() );
        }

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

        $resp = $this->getResponseFactory()->create();
        $resp->setStatus( 200 );
        $resp->setHeader( 'Content-Type', 'application/json' );
        $resp->setHeader( 'X-Auth-User', $user->getName() );
        $resp->setHeader( 'X-Auth-User-Id', (string)$user->getId() );
        if ( $neededRight ) { $resp->setHeader( 'X-Auth-Granted-Right', $neededRight ); }
        $resp->setBody( Utils::streamFor( json_encode( [ 'ok' => true ] ) ) );
        return $resp;
    }

    /**
     * Check provisioning-related API paths.
     * Returns array [needLogin(bool), neededRight|null, ownerCheckSucceeded(bool)] or null if not matched.
     */
    private function checkProvisionAuth( string $path, string $method, int $currentUserId ) {
        $needLogin = false; $neededRight = null;
        if ( $method === 'POST' && $path === '/wikis' ) {
            $neededRight = 'create-wiki';
        } elseif ( $method === 'GET' && $path === '/wikis/public' ) {
            // public list open
        } elseif ( $method === 'GET' && preg_match('#^/wikis/slug/[a-z0-9\-]{1,120}/exists$#', $path) ) {
            $needLogin = true; // require login to probe slugs
        } elseif ( $method === 'GET' && $path === '/wikis' ) {
            // legacy list; allow public
        } elseif ( $method === 'DELETE' && preg_match('#^/wikis/[a-z0-9\-]{1,120}$#', $path) ) {
            // delete wiki -> require login; service will verify owner
            $needLogin = true;
        } elseif ( $method === 'GET' && preg_match('#^/users/(\d+)/wikis$#', $path, $m) ) {
            $needLogin = true;
            $uid = (int)$m[1];
            if ( $uid !== $currentUserId ) {
                $neededRight = 'create-wiki';
            }
        } elseif ( $method === 'GET' && preg_match('#^/tasks/[A-Za-z0-9\-]+/events$#', $path) ) {
            $needLogin = true;
        } else {
            return null; // not a provisioning path
        }
        return [ $needLogin, $neededRight ];
    }

    // Management auth moved to WikiManage extension.
}
