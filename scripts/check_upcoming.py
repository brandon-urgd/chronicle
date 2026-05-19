import sqlite3
from datetime import date, timedelta

today = date.today()
tomorrow = today + timedelta(days=1)
next_week = today + timedelta(days=7)

print(f'Today: {today}')
print(f'Tomorrow: {tomorrow}')
print(f'Next week: {next_week}')
print(f'Today is: {today.strftime("%A")}')

conn = sqlite3.connect('../backend/data/chronicle.db')
conn.row_factory = sqlite3.Row

print(f'\n=== Pending instances for today ({today}) ===')
for r in conn.execute("SELECT sii.id, si.name, si.item_class, sii.due_date, sii.status FROM scheduled_item_instances sii JOIN scheduled_items si ON sii.scheduled_item_id = si.id WHERE sii.due_date = ? AND sii.status = 'pending'", (str(today),)):
    print(dict(r))

print(f'\n=== Pending instances tomorrow to next week ({tomorrow} to {next_week}) ===')
for r in conn.execute("SELECT sii.id, si.name, si.item_class, sii.due_date, sii.status FROM scheduled_item_instances sii JOIN scheduled_items si ON sii.scheduled_item_id = si.id WHERE sii.due_date >= ? AND sii.due_date <= ? AND sii.status = 'pending' ORDER BY sii.due_date", (str(tomorrow), str(next_week))):
    print(dict(r))

print(f'\n=== What /api/scheduled-items/due returns ===')
# Check the due endpoint
for r in conn.execute("""
    SELECT sii.id, si.name, si.item_class, sii.due_date, sii.status
    FROM scheduled_item_instances sii
    JOIN scheduled_items si ON sii.scheduled_item_id = si.id
    WHERE sii.status = 'pending' AND sii.due_date <= ?
    ORDER BY sii.due_date
""", (str(today),)):
    print(dict(r))

conn.close()
