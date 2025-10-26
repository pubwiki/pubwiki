OAuthCentralIDCompact
====================

This extension patches infinite recursion in CentralIdLookup when both OAuth and $wgMWOAuthSharedUserIDs are enabled.

Installation
------------
1. Clone or copy this extension into your extensions/ directory.
2. Add the following to your LocalSettings.php:

wfLoadExtension( 'OAuthCentralIDCompact' );

This will register a CentralIdLookupProvider that prevents recursion.

How it works
------------
The provider overrides LocalIdLookup and adds a static recursion guard to prevent infinite loops when resolving central IDs, especially during OAuth permission checks.

