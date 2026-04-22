<!--
skills/frameworks/django.md — Django — ```

## Project Structure ```
-->
# Django

## Project Structure

```
project/
├── config/              ← Django settings package
│   ├── settings/
│   │   ├── base.py
│   │   ├── local.py
│   │   └── production.py
│   ├── urls.py
│   └── wsgi.py
├── apps/
│   ├── users/           ← Feature-bounded app
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   ├── urls.py
│   │   └── tests/
│   └── items/
├── manage.py
└── requirements/
    ├── base.txt
    ├── local.txt
    └── production.txt
```

Keep apps small and feature-bounded. Do not put everything in one app.

## Models

### Field choices

- `CharField` / `TextField` — strings; always set `blank=False` unless optional
- `UUIDField(default=uuid.uuid4, primary_key=True)` — preferred over auto-increment for external-facing IDs
- `JSONField` — use sparingly; prefer normalized columns for queryable data
- `select_related` for FK, `prefetch_related` for M2M — avoid N+1 queries

### Migrations

```bash
python manage.py makemigrations --check    # CI gate — fail if migrations needed
python manage.py migrate --plan            # Preview before applying
```

- Never edit applied migrations; create new ones
- For large tables, use `RunSQL` with `CONCURRENTLY` for index additions in production
- Zero-downtime: add nullable column → deploy → backfill → add constraint → deploy

### Model managers

Encapsulate query logic in managers, not views:

```python
class PublishedManager(models.Manager):
  def get_queryset(self):
    return super().get_queryset().filter(status='published')

class Item(models.Model):
  objects = models.Manager()
  published = PublishedManager()
```

## Views

### Prefer Class-Based Views (CBV) for standard CRUD

```python
class ItemDetailView(LoginRequiredMixin, DetailView):
  model = Item
  template_name = 'items/detail.html'
  context_object_name = 'item'
```

Use function-based views for one-off logic that doesn't fit CBV patterns.

### Django REST Framework (DRF)

```python
class ItemViewSet(viewsets.ModelViewSet):
  queryset = Item.objects.select_related('owner')
  serializer_class = ItemSerializer
  permission_classes = [IsAuthenticated]
  filterset_fields = ['status']
```

Routers auto-wire CRUD endpoints:

```python
router = DefaultRouter()
router.register('items', ItemViewSet)
urlpatterns = [path('api/', include(router.urls))]
```

### Serializer validation

```python
class ItemSerializer(serializers.ModelSerializer):
  class Meta:
    model = Item
    fields = ['id', 'title', 'status']
    read_only_fields = ['id']

  def validate_title(self, value):
    if len(value) < 3:
      raise serializers.ValidationError('Title too short.')
    return value
```

## Security

- `SECRET_KEY` from env — never commit
- `ALLOWED_HOSTS` locked down in production
- `DEBUG = False` in production (template errors expose internals)
- CSRF: enabled by default for form views; DRF uses `SessionAuthentication` + CSRF for browser clients
- `django-environ` or `python-decouple` for settings from environment variables
- Content security policy: `django-csp` middleware
- SQL: always use ORM or parameterized `raw()` — never string-format user input into queries

## Testing

```python
class ItemAPITest(APITestCase):
  def setUp(self):
    self.user = User.objects.create_user(username='tester', password='pass')
    self.client.force_authenticate(self.user)

  def test_create_item(self):
    resp = self.client.post('/api/items/', {'title': 'New Item'})
    self.assertEqual(resp.status_code, 201)
    self.assertEqual(Item.objects.count(), 1)
```

- Use `APITestCase` (DRF) for API tests — wraps each test in a transaction that rolls back
- `factory_boy` for fixtures — more maintainable than raw `create()`
- `pytest-django` with `@pytest.mark.django_db` for pytest-style tests
- `django-silk` or `django-debug-toolbar` for query profiling in development

## Performance

- Database: add `db_index=True` for filtered columns; `select_related`/`prefetch_related` to eliminate N+1
- Caching: `django.core.cache` with Redis backend (`django-redis`)
- Async views: `async def` views supported in Django 4.1+ — use for I/O-bound operations with `asyncio`
- Task queues: `Celery` + Redis/RabbitMQ for background jobs; `django-celery-beat` for scheduling
- `gunicorn` + `uvicorn` workers for async support in production

## Common Pitfalls

- `objects.all()` in views without pagination — always use `Paginator` or DRF `pagination_class`
- Accessing related objects in a loop without `select_related` — profile with `django-debug-toolbar`
- `settings.DEBUG` checks in production-like environments — use environment-specific settings modules
- File uploads to local storage in production — use `django-storages` with S3/GCS
- Signals for business logic — prefer explicit service functions; signals are invisible and hard to test
