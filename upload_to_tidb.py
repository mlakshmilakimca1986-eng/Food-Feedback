import pandas as pd
import pymysql
import os
import math

host = "gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com"
port = 4000
user = "KqoqWbeyfmufP7y.root"
password = "a6GfOcd9lvniJ3mq"
database = "food_feedback"
excel_path = r"F:\Projects\Food Feedback\student_data - 2026.xlsx"

print("Reading student data from Excel...")
df = pd.read_excel(excel_path)

# Rename columns to match database schema
df = df.rename(columns={
    'SCS Number': 'scsNumber',
    'Student Name': 'studentName',
    'Category': 'category',
    'Section': 'section',
    'WhatsApp Number': 'whatsAppNumber',
    'Campus': 'campus'
})

# Filter out empty or NaN values
df = df.where(pd.notnull(df), None)
records = df.to_dict(orient='records')
total_records = len(records)
print(f"Loaded {total_records} student records from Excel.")

print("Connecting to TiDB Cloud...")
try:
    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        ssl={'ssl': {}}
    )
    print("Connection successful!")
    
    with conn.cursor() as cursor:
        # 1. Insert default warden user
        print("Inserting default warden user...")
        default_warden = {
            "email": "warden@srichaitanyaschool.net",
            "password": "Warden@123",
            "createdAt": "2026-06-17 12:00:00"
        }
        cursor.execute("""
            INSERT INTO wardens (email, password, createdAt)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE password=VALUES(password);
        """, (default_warden['email'], default_warden['password'], default_warden['createdAt']))
        
        # 2. Insert student data in batches
        print("Inserting students into database...")
        batch_size = 200
        for i in range(0, total_records, batch_size):
            batch = records[i:i + batch_size]
            sql = """
                INSERT INTO students (scsNumber, studentName, category, section, whatsAppNumber, campus)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE 
                    studentName=VALUES(studentName), 
                    category=VALUES(category), 
                    section=VALUES(section), 
                    whatsAppNumber=VALUES(whatsAppNumber), 
                    campus=VALUES(campus);
            """
            val_tuples = [
                (
                    s['scsNumber'],
                    s['studentName'],
                    s['category'],
                    s['section'],
                    str(s['whatsAppNumber']) if s['whatsAppNumber'] else None,
                    s['campus']
                )
                for s in batch if s['scsNumber']
            ]
            
            cursor.executemany(sql, val_tuples)
            print(f"Uploaded batch {i // batch_size + 1} ({i + len(batch)} / {total_records} records)...")
            
        conn.commit()
        print("All student records successfully imported to TiDB Cloud database!")

    conn.close()
except Exception as e:
    print("Database upload failed:", e)
