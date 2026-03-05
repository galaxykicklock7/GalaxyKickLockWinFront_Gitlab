# SUPABASE SQL FILES

This folder contains all SQL files for setting up and updating the Supabase database.

## 📋 QUICK START - Run These Files in Order

### 1. Initial Setup (First Time Only)
Run these files when setting up the database for the first time:

```
1. COMPLETE_DATABASE_SETUP.sql       - Complete database schema (users, tokens, metrics)
2. AI_CORE_COMPLETE_SETUP.sql        - AI Core tables and functions
3. ADD_TIMING_COLUMNS.sql            - Add timing tracking columns
```

### 2. Critical Updates (Run These Now!)
If you already have the database set up, run these to fix current issues:

```
1. UPDATE_RECORD_FUNCTION_WITH_PING.sql  - Fix ping_ms and context recording
2. UPDATE_GET_METRICS_FUNCTION.sql       - Fix ML Learning data retrieval
```

## 📁 FILE DESCRIPTIONS

### Core Setup Files
- **COMPLETE_DATABASE_SETUP.sql** - Full database schema including users, tokens, and imprisonment metrics
- **AI_CORE_COMPLETE_SETUP.sql** - AI learning system (cache, context log, functions)
- **ADD_TIMING_COLUMNS.sql** - Adds timing_value and timing_type columns for ML tracking

### Update Files (Apply After Setup)
- **UPDATE_RECORD_FUNCTION_WITH_PING.sql** - Updates record_imprisonment_metric to accept ping_ms and context
- **UPDATE_GET_METRICS_FUNCTION.sql** - Updates get_imprisonment_metrics to return ML fields
- **ADD_USERNAME_TO_METRICS.sql** - Adds username field and cleanup function
- **METRICS_FUNCTIONS_FIXED.sql** - Fixed version of metrics functions
- **METRICS_WITH_3S_ERROR.sql** - Adds is_success field for tracking 3S errors

## 🚀 HOW TO RUN

### Method 1: Supabase Dashboard (Recommended)
1. Open https://supabase.com/dashboard
2. Select your project
3. Click "SQL Editor" in left sidebar
4. Click "New Query"
5. Copy and paste the SQL file contents
6. Click "Run"
7. Check for "Success" message

### Method 2: Supabase CLI
```bash
supabase db execute --file supabase/FILENAME.sql
```

## ⚠️ CURRENT ISSUES & FIXES

### Issue 1: ping_ms and context are NULL
**Fix:** Run `UPDATE_RECORD_FUNCTION_WITH_PING.sql`

**What it does:**
- Updates `record_imprisonment_metric` function to accept `p_ping_ms` and `p_context` parameters
- Allows AI Core to save server ping and context (FAST/NORMAL/SLOW) for each attempt

### Issue 2: ML Learning modal shows "No ML Learning Data Yet"
**Fix:** Run `UPDATE_GET_METRICS_FUNCTION.sql`

**What it does:**
- Updates `get_imprisonment_metrics` function to return ML fields:
  - `timingValue` - The timing used (ms)
  - `timingType` - 'attack' or 'defense'
  - `pingMs` - Server ping
  - `context` - Server context (FAST/NORMAL/SLOW)
  - `createdAt` - Timestamp
- Frontend ML Learning modal needs these fields to display data

## 📊 DATABASE SCHEMA

### Tables
- **users** - User accounts (from Supabase Auth)
- **tokens** - Access tokens for users
- **imprisonment_metrics** - Imprisonment attempt tracking
- **ai_learning_cache** - AI optimal timing cache
- **ai_context_log** - Server context detection log

### Key Functions
- **record_imprisonment_metric()** - Record imprisonment attempt
- **get_imprisonment_metrics()** - Retrieve metrics for a connection
- **check_stuck_at_max()** - Detect if timer is stuck at maximum
- **ai_get_personal_optimal()** - Get user's optimal timing
- **ai_get_transfer_learning_optimal()** - Get community optimal timing
- **ai_record_context()** - Record server context detection
- **cleanup_user_metrics()** - Clean up old metrics by username

## 🔍 VERIFICATION QUERIES

### Check if ping_ms and context are being saved
```sql
SELECT 
  player_name,
  timing_value,
  timing_type,
  ping_ms,
  context,
  is_success,
  created_at
FROM imprisonment_metrics
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 10;
```

### Check AI learning cache
```sql
SELECT 
  connection_number,
  context,
  timing_type,
  optimal_timing,
  success_rate,
  total_attempts
FROM ai_learning_cache
WHERE user_id = 'YOUR_USER_ID'
ORDER BY last_updated DESC;
```

### Check AI context log
```sql
SELECT 
  connection_number,
  ping_ms,
  context,
  detected_at
FROM ai_context_log
WHERE user_id = 'YOUR_USER_ID'
ORDER BY detected_at DESC
LIMIT 10;
```

## 📝 NOTES

- Always run SQL files in Supabase SQL Editor, not in your application
- Check for "Success" message after running each file
- If you get errors, check if the table/function already exists
- Some files drop existing functions before creating new ones (safe to run multiple times)
- After running updates, restart your backend to pick up changes

## 🆘 TROUBLESHOOTING

### "Function already exists" error
- The file includes `DROP FUNCTION IF EXISTS` - this is normal
- The error means the function is being replaced (expected behavior)

### "Column already exists" error
- The file includes `ADD COLUMN IF NOT EXISTS` - this is safe
- The error means the column was already added (can be ignored)

### "Permission denied" error
- Make sure you're logged in to Supabase Dashboard
- Check that you have admin access to the project

### Changes not taking effect
- Restart your backend after running SQL updates
- Clear browser cache and refresh frontend
- Check backend logs for errors

## 📚 RELATED DOCUMENTATION

- `AI_CORE_README.md` - AI Core system documentation
- `BRAIN_ICON_WORKING_NEXT_STEPS.md` - ML Learning dashboard setup guide
- `FIX_SUMMARY.md` - Detailed fix documentation for ping/context issue
