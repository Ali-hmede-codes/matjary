import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from '../../apps/api/src/modules/categories/dto/category.dto';

const valid = (type: new () => object, value: unknown) =>
  validateSync(plainToInstance(type, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

test('category image links accept direct http(s) image URLs', () => {
  for (const imageUrl of [
    'https://cdn.example.com/categories/video-production.png',
    'https://cdn.example.com/category.webp?width=600&quality=80',
    'http://localhost:5173/category.png',
    'HTTPS://EXAMPLE.COM/CATEGORY.PNG',
  ]) {
    assert.equal(
      valid(CreateCategoryDto, { name: 'Video', imageUrl }).length,
      0,
      imageUrl,
    );
    assert.equal(valid(UpdateCategoryDto, { imageUrl }).length, 0, imageUrl);
  }
});

test('category image links trim whitespace and an empty value clears them', () => {
  const created = plainToInstance(CreateCategoryDto, {
    name: '  Video  ',
    imageUrl: '  https://cdn.example.com/video.png  ',
  });
  assert.equal(created.imageUrl, 'https://cdn.example.com/video.png');
  const cleared = plainToInstance(UpdateCategoryDto, { imageUrl: '   ' });
  assert.equal(cleared.imageUrl, null);
  assert.equal(valid(UpdateCategoryDto, { imageUrl: null }).length, 0);
  assert.equal(valid(UpdateCategoryDto, {}).length, 0);
});

test('category image links reject anything but an absolute http(s) URL', () => {
  for (const imageUrl of [
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'ftp://example.com/category.png',
    '//example.com/category.png',
    'categories/video.png',
    'not a link',
    'https://user:secret@example.com/category.png',
    `https://example.com/${'a'.repeat(2050)}.png`,
    42,
    { url: 'https://example.com/a.png' },
  ])
    assert.ok(
      valid(CreateCategoryDto, { name: 'Video', imageUrl }).length > 0,
      JSON.stringify(imageUrl),
    );
  assert.ok(
    valid(CreateCategoryDto, { name: 'Video', unexpectedKnob: true }).length >
      0,
  );
});
