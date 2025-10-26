<?php
/**
 * PublicAudience: A patched anonymous user for CentralIdLookup recursion prevention
 * 
 * This class overrides getRequest() to return a NullRequest, preventing infinite
 * recursion in permission checks during OAuth + shared user ID scenarios.
 */

use MediaWiki\User\User;
use MediaWiki\Request\WebRequest;

class PublicAudience extends User {
    /**
     * Override getRequest to return NullRequest, breaking recursion chain
     * 
     * @return WebRequest
     */
    public function getRequest(): WebRequest {
        require_once __DIR__ . '/NullRequest.php';
        return new NullRequest();
    }
}
