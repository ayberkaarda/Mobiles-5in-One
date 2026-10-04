<?php

namespace App\Policies;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminAccess;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Models\User;
use App\Policies\Concerns\AuthorizesActors;
use Illuminate\Auth\Access\Response;

/**
 * Shop documents: the owner uploads (matrix 3.2, presign), only admin roles with the
 * document permission open them through the panel (matrix 4). No API role ever reads a
 * document, including the owner who uploaded it.
 */
class ShopDocumentPolicy
{
    use AuthorizesActors;

    /**
     * POST shops/{id}/documents/presign: owner of the shop.
     */
    public function create(User|AnonDevice $actor, Shop $shop): Response
    {
        return $this->ownerOf($actor, $shop);
    }

    /**
     * Open a document: panel session with the document permission only. A panel user
     * without the permission is refused (403); to every API caller, the owner included,
     * a document id looks missing.
     */
    public function view(User|AnonDevice $actor, ShopDocument $document): Response
    {
        if (! $actor instanceof User || AdminAccess::viaApiToken($actor)) {
            return $this->notFoundForCaller();
        }

        return $this->allowWhen(AdminAccess::allows($actor, AdminPermission::ViewDocuments));
    }
}
