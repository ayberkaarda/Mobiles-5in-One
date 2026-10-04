import 'dart:typed_data';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/data/repositories/impl/dio_shops_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http_mock_adapter/http_mock_adapter.dart';

import '../../helpers/fake_api.dart';
import '../../helpers/fixtures.dart';

void main() {
  late FakeApi api;
  late DioShopsRepository repo;
  const shopId = '0192a4c1-7000-7a10-9b3c-000000000001';

  setUp(() {
    api = FakeApi(userToken: dummyToken());
    repo = DioShopsRepository(api.client);
  });

  test('nearby sends near, radius and hasAvailable; reads meta', () async {
    api.adapter.onGet(
      'shops',
      (s) => s.reply(200, fixture('shops_nearby')),
      queryParameters: {
        'near': '41.06,28.99',
        'radius': 3000,
        'hasAvailable': 1,
      },
    );

    final page = await repo.nearby(41.06, 28.99, hasAvailable: true);

    expect(page.shops, hasLength(2));
    expect(page.nextCursor, 'page-2');
    expect(page.radius, 3000);
    expect(api.last.queryParameters.containsKey('cursor'), isFalse);
  });

  test('nearby passes the cursor and omits hasAvailable when false', () async {
    api.adapter.onGet(
      'shops',
      (s) => s.reply(200, {
        'data': <Object>[],
        'meta': {'radius': 1500, 'next_cursor': null},
      }),
      queryParameters: {
        'near': '39.93,32.86',
        'radius': 1500,
        'cursor': 'page-2',
      },
    );

    final page = await repo.nearby(
      39.93,
      32.86,
      radiusM: 1500,
      cursor: 'page-2',
    );

    expect(page.shops, isEmpty);
    expect(page.nextCursor, isNull);
    expect(api.last.queryParameters.containsKey('hasAvailable'), isFalse);
  });

  test('bySlug distinguishes the public and owner shapes', () async {
    api.adapter
      ..onGet(
        'shops/ornek-kose-firini-sisli',
        (s) => s.reply(200, fixture('shop_public')),
      )
      ..onGet(
        'shops/benim-dukkanim',
        (s) => s.reply(200, fixture('shop_owner')),
      );

    expect(
      await repo.bySlug('ornek-kose-firini-sisli'),
      isA<PublicShopDetails>(),
    );
    expect(await repo.bySlug('benim-dukkanim'), isA<OwnerShopDetails>());
  });

  test('unknown slug is not_found', () async {
    api.adapter.onGet(
      'shops/yok',
      (s) => s.reply(
        404,
        '{"type":"https://askida.app/problems/not_found","title":"x",'
        '"status":404,"code":"not_found","request_id":"req-404-1"}',
        headers: FakeApi.problemHeaders(),
      ),
    );
    await expectLater(
      repo.bySlug('yok'),
      throwsA(isA<ApiProblem>().having((p) => p.code, 'code', 'not_found')),
    );
  });

  test('create and update send snake_case drafts', () async {
    api.adapter
      ..onPost(
        'shops',
        (s) => s.reply(201, fixture('shop_owner')),
        data: {
          'name': '[ÖRNEK] Köşe Fırını',
          'type': 'bakery',
          'address': 'Halaskargazi Cd. 1',
          'il': 'İstanbul',
          'ilce': 'Şişli',
          'lat': 41.0602,
          'lng': 28.9877,
          'listed_on_web': true,
        },
      )
      ..onPatch(
        'shops/$shopId',
        (s) => s.reply(200, fixture('shop_owner')),
        data: {'address': 'Yeni adres 5'},
      );

    final created = await repo.create(
      const ShopDraft(
        name: '[ÖRNEK] Köşe Fırını',
        type: ShopType.bakery,
        address: 'Halaskargazi Cd. 1',
        il: 'İstanbul',
        ilce: 'Şişli',
        lat: 41.0602,
        lng: 28.9877,
        listedOnWeb: true,
      ),
    );
    expect(created.verificationState, VerificationState.pending);

    await repo.update(shopId, const ShopDraft(address: 'Yeni adres 5'));
  });

  test('catalog list, create and update', () async {
    api.adapter
      ..onGet(
        'shops/$shopId/items',
        (s) => s.reply(200, fixture('items_owner')),
      )
      ..onPost(
        'shops/$shopId/items',
        (s) => s.reply(201, fixture('item_owner')),
        data: {
          'name': 'Ekmek',
          'category': 'ekmek',
          'price_minor': 1500,
          'daily_cap': 50,
        },
      )
      ..onPatch(
        'shops/$shopId/items/item-1',
        (s) => s.reply(200, fixture('item_owner')),
        data: {'active': false},
      );

    expect(await repo.items(shopId), hasLength(2));
    final item = await repo.createItem(
      shopId,
      const ItemDraft(
        name: 'Ekmek',
        category: ItemCategory.ekmek,
        priceMinor: 1500,
        dailyCap: 50,
      ),
    );
    expect(item.dailyCap, 50);
    await repo.updateItem(shopId, 'item-1', const ItemDraft(active: false));
  });

  test('document presign, upload and confirm', () async {
    api.adapter
      ..onPost(
        'shops/$shopId/documents/presign',
        (s) => s.reply(201, fixture('document_presign')),
        data: {'kind': 'vergi_levhasi', 'mime': 'application/pdf', 'size': 4},
      )
      ..onPost(
        'shops/$shopId/documents/doc-1/confirm',
        (s) => s.reply(200, fixture('document_confirmed')),
        data: Matchers.any,
      );

    final presigned = await repo.presignDocument(
      shopId,
      kind: DocumentKind.vergiLevhasi,
      mime: 'application/pdf',
      size: 4,
    );
    final url = Uri.parse(presigned.upload.url);
    api.uploads.onPut(
      url.toString(),
      (s) => s.reply(200, null),
      data: Matchers.any,
    );
    await repo.uploadDocument(
      url,
      Uint8List.fromList([0x25, 0x50, 0x44, 0x46]),
      'application/pdf',
      headers: presigned.upload.headers,
    );
    final confirmed = await repo.confirmDocument(shopId, 'doc-1');

    expect(confirmed.state, DocumentState.uploaded);
  });

  test('a refused document surfaces unsupported_media_type', () async {
    api.adapter.onPost(
      'shops/$shopId/documents/doc-2/confirm',
      (s) => s.reply(
        415,
        '{"type":"https://askida.app/problems/unsupported_media_type",'
        '"title":"x","status":415,"code":"unsupported_media_type",'
        '"request_id":"req-415-1"}',
        headers: FakeApi.problemHeaders(),
      ),
      data: Matchers.any,
    );
    await expectLater(
      repo.confirmDocument(shopId, 'doc-2'),
      throwsA(
        isA<ApiProblem>().having(
          (p) => p.code,
          'code',
          'unsupported_media_type',
        ),
      ),
    );
  });
}
