# Construct Embedding Boundary System

The Construct embedding boundary system prevents internal Construct information from being exposed unless explicitly embedded, and enables running multiple Construct instances without cross-contamination.

## Core Components

### 1. Mode-Aware Navigation
- **Dashboard**: Shows/hides navigation items based on embed mode
- **Three modes**: `init` (basic), `embed`/`live` (full access)
- **API endpoint**: `/api/mode` provides accurate mode detection

### 2. Instance Namespace Support
- **Environment variable**: `CONSTRUCT_INSTANCE_ID`
- **Dashboard display**: Shows instance ID in header
- **Isolation**: Different instances use separate configurations

### 3. Boundary API
- **Status endpoint**: `/api/embed/boundary` - returns boundary status
- **Registration endpoint**: `/api/embed/boundary/register` - registers parent-child relationships
- **Boundary tracking**: Stores parent instance info and relationship metadata

### 4. Isolation Testing
- **Test suite**: `test-instance-isolation.mjs` verifies separation
- **Test vectors**: Config, data, ports, state, directories
- **Best practices**: Provides guidance for production embedding

## Usage Examples

### Basic Mode Detection
```javascript
// Frontend: Determine navigation based on mode
const { mode, instanceId } = await fetchMode();
if (mode === 'embed' || mode === 'live') {
  // Show full navigation (Agents, Skills, Commands, etc.)
} else {
  // Show basic navigation only (Resources, Workflow, Approvals, Snapshots)
}
```

### Instance Registration
```javascript
// Parent instance registers a child instance
await registerEmbedBoundary({
  parentInstance: 'construct-main',
  parentUrl: 'http://localhost:4242',
  childInstanceId: 'construct-embedded-1'
});
```

### Boundary Status Check
```javascript
// Check if running in embedded mode
const boundary = await fetchEmbedBoundary();
if (boundary.isEmbedded) {
  console.log(`Running as child of ${boundary.parentConstruct}`);
}
```

## Configuration

### Environment Variables
```bash
# Required for instance identification
CONSTRUCT_INSTANCE_ID=construct-production-1

# Optional parent relationship (set by parent instance)
CONSTRUCT_PARENT_INSTANCE=construct-main
CONSTRUCT_PARENT_URL=http://localhost:4242
```

### Dashboard Integration
The dashboard automatically:
1. Fetches mode from `/api/mode`
2. Displays instance ID if set
3. Adjusts navigation based on mode
4. Shows boundary status if embedded

## Isolation Guarantees

The system ensures:
1. **Config separation**: Different instances don't share `config.env`
2. **Data separation**: Observations, sessions, snapshots stay separate
3. **Port separation**: Instances use different network ports
4. **State separation**: Runtime state doesn't leak between instances
5. **Navigation security**: Internal details hidden in `init` mode

## Testing

Run isolation tests:
```bash
node test-instance-isolation.mjs
```

Run boundary API tests:
```bash
node test-embed-boundary.mjs
```

## Best Practices

1. **Always set `CONSTRUCT_INSTANCE_ID`** for embedded instances
2. **Use boundary registration** for parent-child relationships
3. **Monitor config shadowing warnings** for stale environment variables
4. **Test isolation** before deploying multiple instances
5. **Consider Docker/container isolation** for production deployments

## Security Considerations

- The `init` mode prevents exposure of internal Construct details
- Instance IDs help track and audit different running instances
- Boundary registration creates explicit parent-child relationships
- Isolation testing verifies separation before production use