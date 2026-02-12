-- Homepage content storage (admin-managed)
-- Run this against your Cloudflare D1 database.

create table if not exists site_content (
  key text primary key,
  json text not null,
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by text
);

-- Seed row (optional). You can also create/update via /api/homepage (admin only).
insert into site_content (key, json)
values (
  'homepage',
  json_object(
    'billboard', json_object(
      'title', 'New Collections',
      'description', 'Lorem ipsum dolor sit amet consectetur adipisicing elit. Saepe voluptas ut dolorum consequuntur, adipisci repellat!'
    ),
    'slides', json_array(
      json_object(
        'image', 'images/banner-image-6.jpg',
        'title', 'Soft leather jackets',
        'text', 'Scelerisque duis aliquam qui lorem ipsum dolor amet, consectetur adipiscing elit.',
        'href', 'index.html',
        'linkLabel', 'Discover Now'
      )
    )
  )
)
on conflict(key) do nothing;
