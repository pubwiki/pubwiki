<?php
use MediaWiki\Request\WebRequest;
use MediaWiki\Session\Session;

/**
 * NullSession: a dummy session object for recursion guard
 */
class NullSession extends Session {
    public function __construct() {}

    public function __destruct() {}

    public function getAllowedUserRights() {
        return null;
    }
}

/**
 * NullRequest: a dummy request object for recursion guard
 */
class NullRequest extends WebRequest {
    public function getSession(): Session {
        return new NullSession();
    }
}
