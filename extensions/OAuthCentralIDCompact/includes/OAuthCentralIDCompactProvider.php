<?php
/**
 * OAuthCentralIDCompactProvider
 *
 * Prevents infinite recursion in CentralIdLookup when OAuth and shared user IDs are enabled.
 *
 * @file
 * @ingroup Extensions
 */

use MediaWiki\User\CentralId\LocalIdLookup;
use MediaWiki\User\User;
use MediaWiki\Config\Config;
use Wikimedia\Rdbms\IConnectionProvider;
use MediaWiki\Block\HideUserUtils;
use Wikimedia\Rdbms\IDBAccessObject;

class OAuthCentralIDCompactProvider extends LocalIdLookup {
    private IConnectionProvider $dbProvider;
	private HideUserUtils $hideUserUtils;

    /**
     * @param Config $config
     * @param IConnectionProvider $dbProvider
     * @param HideUserUtils $hideUserUtils
     */
    public function __construct(
        Config $config,
        IConnectionProvider $dbProvider,
        HideUserUtils $hideUserUtils
    ) {
        parent::__construct($config, $dbProvider, $hideUserUtils);
        $this->dbProvider = $dbProvider;
		$this->hideUserUtils = $hideUserUtils;
    }

    /**
     * Override lookupCentralIds to prevent recursion
     *
     * @param array $names
     * @param User|null $audience
     * @param int $flags
     * @return array
     */
    public function lookupCentralIds(
		array $idToName, $audience = self::AUDIENCE_PUBLIC, $flags = IDBAccessObject::READ_NORMAL
	): array {
        if (!$idToName) {
            return [];
        }

        // Patch: Replace anonymous user with PublicAudience to prevent recursion
        if ($audience === self::AUDIENCE_PUBLIC) {
            require_once __DIR__ . '/PublicAudience.php';
            $audience = new PublicAudience();
        } else {
            $audience = $this->checkAudience($audience);
        }

        $db = \Wikimedia\Rdbms\DBAccessObjectUtils::getDBFromRecency($this->dbProvider, $flags);
        $queryBuilder = $db->newSelectQueryBuilder();
        $queryBuilder
            ->select(['user_id', 'user_name'])
            ->from('user')
            ->where(['user_id' => array_map('intval', array_keys($idToName))])
            ->recency($flags);

        if ($audience && !$audience->isAllowed('hideuser')) {
            $this->hideUserUtils->addFieldToBuilder($queryBuilder);
        }

        $res = $queryBuilder->caller(__METHOD__)->fetchResultSet();
        foreach ($res as $row) {
            $idToName[$row->user_id] = empty($row->hu_deleted) ? $row->user_name : '';
        }

        return $idToName;
    }
}
